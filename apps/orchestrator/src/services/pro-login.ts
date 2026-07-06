import { createHash, randomInt } from 'node:crypto';
import type { AppDeps } from '../deps.js';
import { QuoteError } from './quotes.js';

const OTP_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

// Step 1: prove-you-own-the-number challenge. The code goes out on the
// professional's WhatsApp via the outbox (dev-log adapter prints it in dev);
// in development the code is also returned so the flow is testable without
// a phone.
export async function startProLogin(
  deps: AppDeps,
  whatsapp: string,
  dev: boolean,
): Promise<{ challengeId: string; devCode?: string }> {
  const { rows } = await deps.pool.query(
    `SELECT id, whatsapp_e164, preferred_channel FROM professionals
     WHERE whatsapp_e164 = $1 AND is_active
       AND (provider_type = 'SERVICE' OR verification_status = 'VERIFIED')`,
    [whatsapp],
  );
  const pro = rows[0];
  if (!pro) throw new QuoteError(404, 'no active provider with that WhatsApp number');

  return issueOtpChallenge(deps, pro, dev);
}

// Shared by login and service-provider registration: create the OTP
// challenge and queue the code to the provider's WhatsApp.
export async function issueOtpChallenge(
  deps: AppDeps,
  pro: { id: string; whatsapp_e164: string; preferred_channel: string },
  dev: boolean,
): Promise<{ challengeId: string; devCode?: string }> {
  const code = String(randomInt(100000, 1000000));
  const now = deps.now();
  const { rows: challenge } = await deps.pool.query(
    `INSERT INTO login_otps (professional_id, code_hash, expires_at) VALUES ($1, $2, $3) RETURNING id`,
    [pro.id, hashOtp(code), new Date(now.getTime() + OTP_TTL_MS)],
  );

  await deps.pool.query(
    `INSERT INTO outbox_messages (request_id, channel, recipient, template_key, payload, idempotency_key)
     VALUES (NULL, $1, $2, 'VERIFICATION_OTP', $3, $4) ON CONFLICT (idempotency_key) DO NOTHING`,
    [pro.preferred_channel, pro.whatsapp_e164, JSON.stringify({ code }), `login-otp:${challenge[0].id}`],
  );

  return { challengeId: challenge[0].id, ...(dev ? { devCode: code } : {}) };
}

export interface RegisterServiceInput {
  displayName: string;
  businessName: string;
  whatsapp: string;
  flatPrice?: string;
}

// Light registration for SERVICE providers: name + business + WhatsApp is
// enough — no registry verification. The OTP challenge issued here doubles
// as proof of number ownership before the first portal session; the row is
// bookable immediately (verification_status is never consulted for SERVICE).
export async function registerServiceProvider(
  deps: AppDeps,
  input: RegisterServiceInput,
  dev: boolean,
): Promise<{ providerId: string; challengeId: string; devCode?: string }> {
  const { rows } = await deps.pool.query(
    `INSERT INTO professionals (display_name, business_name, whatsapp_e164, provider_type, category,
                                payout_method, service_flat_price, calcom_user_id, calcom_event_type)
     VALUES ($1, $2, $3, 'SERVICE', 'SERVICE',
             jsonb_build_object('type', 'MPESA', 'msisdn', $3::text), $4, NULL, NULL)
     ON CONFLICT (whatsapp_e164) DO NOTHING
     RETURNING id, whatsapp_e164, preferred_channel`,
    [input.displayName, input.businessName, input.whatsapp, input.flatPrice ?? null],
  );
  const pro = rows[0];
  if (!pro) throw new QuoteError(409, 'that WhatsApp number is already registered — sign in instead');

  const challenge = await issueOtpChallenge(deps, pro, dev);
  return { providerId: pro.id, ...challenge };
}

// Step 2: burn the challenge, return the professional for the session.
export async function verifyProLogin(deps: AppDeps, challengeId: string, code: string): Promise<{ professionalId: string }> {
  const now = deps.now();
  const { rows } = await deps.pool.query(
    `SELECT id, professional_id, code_hash, expires_at, consumed_at, attempts FROM login_otps WHERE id = $1`,
    [challengeId],
  );
  const otp = rows[0];
  if (!otp) throw new QuoteError(404, 'unknown login challenge');
  if (otp.consumed_at) throw new QuoteError(422, 'this code was already used — sign in again');
  if (otp.attempts >= MAX_ATTEMPTS) throw new QuoteError(422, 'too many wrong attempts — sign in again');
  if (new Date(otp.expires_at).getTime() <= now.getTime()) throw new QuoteError(422, 'code expired — sign in again');

  if (hashOtp(code) !== otp.code_hash) {
    await deps.pool.query(`UPDATE login_otps SET attempts = attempts + 1 WHERE id = $1`, [challengeId]);
    throw new QuoteError(422, 'wrong code');
  }

  await deps.pool.query(`UPDATE login_otps SET consumed_at = now() WHERE id = $1`, [challengeId]);
  return { professionalId: otp.professional_id };
}
