import { cardExpiresAt, classifyTier, transition, type Tier } from '@marketplace/core';
import type { AppDeps } from '../deps.js';
import { computeBreakdown, priceFor } from './pricing.js';
import { generateRefCode } from './refcode.js';

export interface CreateQuoteInput {
  clientId: string;
  professionalId: string;
  sessionStart: Date;
  durationMinutes: number;
  brief: string;
  source?: string;
}

export interface QuoteResult {
  requestId: string;
  refCode: string;
  tier: Tier;
  priceGross: string;
  platformFee: string;
  payoutNet: string;
  currency: string;
}

export class QuoteError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'QuoteError';
  }
}

export async function createQuote(deps: AppDeps, input: CreateQuoteInput): Promise<QuoteResult> {
  const now = deps.now();
  if (input.sessionStart.getTime() <= now.getTime()) {
    throw new QuoteError(422, 'sessionStart must be in the future');
  }

  const { rows: profRows } = await deps.pool.query(
    `SELECT id, calcom_user_id, fee_percent, is_active, is_available, verification_status FROM professionals WHERE id = $1`,
    [input.professionalId],
  );
  const professional = profRows[0];
  if (!professional) throw new QuoteError(404, 'professional not found');
  if (!professional.is_active) throw new QuoteError(422, 'professional is not accepting requests');
  if (!professional.is_available) throw new QuoteError(422, 'professional is currently not available for bookings');
  // The verification hard gate: this check in core logic is the enforcement
  // point — non-verified professionals are unbookable regardless of UI.
  if (professional.verification_status !== 'VERIFIED') {
    throw new QuoteError(422, 'professional is not verified');
  }

  const dayStart = new Date(input.sessionStart.getTime() - 24 * 3600_000);
  const dayEnd = new Date(input.sessionStart.getTime() + (input.durationMinutes + 24 * 60) * 60_000);
  const [availability, isWorkingDay] = await Promise.all([
    deps.scheduling.getAvailability(professional.calcom_user_id, dayStart, dayEnd),
    deps.scheduling.isWorkingDay(professional.calcom_user_id, input.sessionStart),
  ]);

  const tier = classifyTier({
    requestedStart: input.sessionStart,
    durationMinutes: input.durationMinutes,
    now,
    availability,
    isWorkingDay,
  });

  const gross = priceFor(deps.pricing, input.professionalId, tier);
  const breakdown = computeBreakdown(gross, professional.fee_percent);
  const refCode = await generateRefCode(deps.pool);

  const { rows } = await deps.pool.query(
    `INSERT INTO requests (ref_code, client_id, professional_id, tier, state, session_start,
                           duration_minutes, brief, price_gross, platform_fee, payout_net, source)
     VALUES ($1, $2, $3, $4, 'REQUESTED', $5, $6, $7, $8, $9, $10, $11) RETURNING id, currency`,
    [
      refCode,
      input.clientId,
      input.professionalId,
      tier,
      input.sessionStart,
      input.durationMinutes,
      input.brief,
      breakdown.gross,
      breakdown.fee,
      breakdown.net,
      input.source ?? 'web',
    ],
  );

  return {
    requestId: rows[0].id,
    refCode,
    tier,
    priceGross: breakdown.gross,
    platformFee: breakdown.fee,
    payoutNet: breakdown.net,
    currency: rows[0].currency,
  };
}

export async function initQuotePayment(deps: AppDeps, requestId: string): Promise<{ authorizationUrl: string }> {
  const { rows } = await deps.pool.query(
    `SELECT r.state, r.price_gross, r.currency, c.email AS client_email, c.phone_e164 AS client_phone
     FROM requests r JOIN clients c ON c.id = r.client_id WHERE r.id = $1`,
    [requestId],
  );
  const row = rows[0];
  if (!row) throw new QuoteError(404, 'request not found');
  if (row.state !== 'REQUESTED') throw new QuoteError(409, `request is ${row.state}, not payable`);
  if (!row.client_email) throw new QuoteError(422, 'client has no email for payment');

  const { authorizationUrl, providerRef } = await deps.payments.initPayment({
    requestId,
    amount: row.price_gross,
    currency: row.currency.trim(),
    clientEmail: row.client_email,
    ...(row.client_phone ? { clientPhone: row.client_phone } : {}),
  });

  await transition(deps.pool, requestId, 'PENDING_PAYMENT', 'CLIENT', 'PAYMENT_INITIATED', { providerRef });
  return { authorizationUrl };
}

// Paystack charge.success -> HELD. The card's acceptance deadline starts
// counting from the moment funds are held, scaled by tier.
export async function confirmQuotePayment(deps: AppDeps, requestId: string, providerRef: string): Promise<void> {
  const { rows } = await deps.pool.query(`SELECT state, tier FROM requests WHERE id = $1`, [requestId]);
  const row = rows[0];
  if (!row) throw new QuoteError(404, 'request not found');
  if (row.state !== 'PENDING_PAYMENT') return; // duplicate/stale webhook; dedup already logged it

  const now = deps.now();
  await deps.pool.query(`UPDATE requests SET card_expires_at = $2 WHERE id = $1`, [
    requestId,
    cardExpiresAt(row.tier, now),
  ]);
  await transition(deps.pool, requestId, 'HELD', 'SYSTEM', 'PAYMENT_CONFIRMED', { providerRef }, { now });
}
