import { cardExpiresAt, classifyTier, findCoveringWindow, transition, type RequestTier } from '@marketplace/core';
import type { AppDeps } from '../deps.js';
import { PLATFORM_DEFAULT_SERVICE_PRICE, computeBreakdown, priceFor } from './pricing.js';
import { generateRefCode } from './refcode.js';
import { countOverlapping, getServiceWindows, withProviderLock } from './service-availability.js';

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
  tier: RequestTier;
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
    `SELECT id, calcom_user_id, fee_percent, is_active, is_available, verification_status,
            provider_type, service_flat_price
     FROM professionals WHERE id = $1`,
    [input.professionalId],
  );
  const professional = profRows[0];
  if (!professional) throw new QuoteError(404, 'professional not found');
  if (!professional.is_active) throw new QuoteError(422, 'professional is not accepting requests');
  if (!professional.is_available) throw new QuoteError(422, 'professional is currently not available for bookings');

  let tier: RequestTier;
  let gross: string;
  if (professional.provider_type === 'SERVICE') {
    // SERVICE providers: no verification gate, no tiers, no Cal.com. The
    // booking must fit inside an open window with remaining capacity and is
    // priced flat. This is a pre-check only — capacity is admitted under the
    // provider lock at payment init and accept.
    const windows = await getServiceWindows(deps.pool, input.professionalId);
    const window = findCoveringWindow(windows, input.sessionStart, input.durationMinutes);
    if (!window) throw new QuoteError(422, 'requested time is outside open hours — pick a time within the business hours');
    const taken = await countOverlapping(deps.pool, input.professionalId, input.sessionStart, input.durationMinutes);
    if (taken >= window.capacity) throw new QuoteError(409, 'fully booked at that time — try another time');
    tier = 'STANDARD';
    gross = professional.service_flat_price ?? PLATFORM_DEFAULT_SERVICE_PRICE;
  } else {
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

    tier = classifyTier({
      requestedStart: input.sessionStart,
      durationMinutes: input.durationMinutes,
      now,
      availability,
      isWorkingDay,
    });

    gross = priceFor(deps.pricing, input.professionalId, tier);
  }
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
    `SELECT r.state, r.price_gross, r.currency, r.professional_id, r.session_start, r.duration_minutes,
            p.provider_type, c.email AS client_email, c.phone_e164 AS client_phone
     FROM requests r
     JOIN clients c ON c.id = r.client_id
     JOIN professionals p ON p.id = r.professional_id
     WHERE r.id = $1`,
    [requestId],
  );
  const row = rows[0];
  if (!row) throw new QuoteError(404, 'request not found');
  if (row.state !== 'REQUESTED') throw new QuoteError(409, `request is ${row.state}, not payable`);
  if (!row.client_email) throw new QuoteError(422, 'client has no email for payment');

  const proceed = async (): Promise<{ authorizationUrl: string }> => {
    const { authorizationUrl, providerRef } = await deps.payments.initPayment({
      requestId,
      amount: row.price_gross,
      currency: row.currency.trim(),
      clientEmail: row.client_email,
      ...(row.client_phone ? { clientPhone: row.client_phone } : {}),
    });

    await transition(deps.pool, requestId, 'PENDING_PAYMENT', 'CLIENT', 'PAYMENT_INITIATED', { providerRef });
    return { authorizationUrl };
  };

  if (row.provider_type !== 'SERVICE') return proceed();

  // First admission point for SERVICE capacity: from PENDING_PAYMENT onward
  // this request counts against the window, so the count-then-admit section
  // runs under the provider lock. The request itself is still REQUESTED and
  // therefore not part of the count.
  return withProviderLock(deps.pool, row.professional_id, async () => {
    const windows = await getServiceWindows(deps.pool, row.professional_id);
    const window = findCoveringWindow(windows, row.session_start, row.duration_minutes);
    if (!window) throw new QuoteError(409, 'the business hours changed — request a new quote');
    const taken = await countOverlapping(deps.pool, row.professional_id, row.session_start, row.duration_minutes);
    if (taken >= window.capacity) throw new QuoteError(409, 'fully booked at that time — request a new quote');
    return proceed();
  });
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
