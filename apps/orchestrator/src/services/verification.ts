import { createHash, randomInt } from 'node:crypto';
import { NAME_MATCH_THRESHOLD, nameMatchScore, type Registry } from '@marketplace/core';
import type { AppDeps } from '../deps.js';
import { QuoteError } from './quotes.js';

export const MAX_VERIFICATION_ATTEMPTS = 3;
const OTP_TTL_MS = 10 * 60_000;

export interface SubmitVerificationInput {
  professionalId: string;
  registry: Registry;
  registrationNumber: string;
  submittedName: string;
}

export interface VerificationResult {
  verificationId: string;
  status: string;
}

function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

// The automated pipeline: registry lookup -> fuzzy name match -> WhatsApp
// OTP. VERIFIED needs all three; registry-not-found rejects (resubmittable
// up to 3 times); anything inconclusive lands in manual review — a failing
// scraper must NEVER strand a professional in PENDING_VERIFICATION.
export async function submitVerification(deps: AppDeps, input: SubmitVerificationInput): Promise<VerificationResult> {
  const { rows: profRows } = await deps.pool.query(
    `SELECT id, whatsapp_e164, preferred_channel, verification_status FROM professionals WHERE id = $1`,
    [input.professionalId],
  );
  const professional = profRows[0];
  if (!professional) throw new QuoteError(404, 'professional not found');
  if (professional.verification_status === 'VERIFIED') throw new QuoteError(409, 'already verified');

  const { rows: attemptRows } = await deps.pool.query(
    `SELECT count(*)::int AS n FROM professional_verifications WHERE professional_id = $1 AND status = 'REJECTED'`,
    [input.professionalId],
  );
  const rejectedAttempts: number = attemptRows[0].n;
  if (rejectedAttempts >= MAX_VERIFICATION_ATTEMPTS) {
    throw new QuoteError(422, 'maximum verification attempts reached; contact support');
  }

  const now = deps.now();
  const otpCode = String(randomInt(100000, 1000000));
  const { rows } = await deps.pool.query(
    `INSERT INTO professional_verifications (professional_id, registry, registration_number, submitted_name, evidence)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      input.professionalId,
      input.registry,
      input.registrationNumber,
      input.submittedName,
      JSON.stringify({ otp: { hash: hashOtp(otpCode), expiresAt: new Date(now.getTime() + OTP_TTL_MS).toISOString() } }),
    ],
  );
  const verificationId: string = rows[0].id;

  await notify(deps, professional, verificationId, 'VERIFICATION_OTP', { code: otpCode });

  // Registry lookup + name match. OTP confirmation arrives separately via
  // the onboarding page; finalization happens on whichever completes last.
  let status: string;
  try {
    const lookup = await deps.registry.lookup(input.registry, input.registrationNumber);
    if (!lookup.found) {
      status = 'REJECTED';
      await deps.pool.query(
        `UPDATE professional_verifications
         SET status = 'REJECTED', checked_at = now(), evidence = evidence || $2
         WHERE id = $1`,
        [verificationId, JSON.stringify({ lookup: lookup.raw, outcome: 'NOT_FOUND' })],
      );
      const attemptsLeft = MAX_VERIFICATION_ATTEMPTS - rejectedAttempts - 1;
      if (attemptsLeft <= 0) {
        await deps.pool.query(`UPDATE professionals SET verification_status = 'REJECTED' WHERE id = $1`, [
          input.professionalId,
        ]);
      }
      await notify(deps, professional, verificationId, 'VERIFICATION_REJECTED', {
        registry: input.registry,
        attemptsLeft,
      });
    } else {
      const score = nameMatchScore(input.submittedName, lookup.registryName ?? '');
      const strongMatch = score >= NAME_MATCH_THRESHOLD;
      status = strongMatch ? 'PENDING_VERIFICATION' : 'NEEDS_MANUAL_REVIEW';
      await deps.pool.query(
        `UPDATE professional_verifications
         SET registry_name = $2, name_match_score = $3, checked_at = now(),
             status = $4, evidence = evidence || $5
         WHERE id = $1`,
        [verificationId, lookup.registryName, score, status, JSON.stringify({ lookup: lookup.raw })],
      );
      if (!strongMatch) {
        await notify(deps, professional, verificationId, 'VERIFICATION_IN_REVIEW', {});
      }
    }
  } catch {
    // Scraper error / timeout / registry changed — manual review, always.
    status = 'NEEDS_MANUAL_REVIEW';
    await deps.pool.query(
      `UPDATE professional_verifications
       SET status = 'NEEDS_MANUAL_REVIEW', checked_at = now(), evidence = evidence || $2
       WHERE id = $1`,
      [verificationId, JSON.stringify({ outcome: 'LOOKUP_ERROR' })],
    );
    await notify(deps, professional, verificationId, 'VERIFICATION_IN_REVIEW', {});
  }

  return { verificationId, status };
}

export async function confirmVerificationOtp(deps: AppDeps, verificationId: string, code: string): Promise<VerificationResult> {
  const { rows } = await deps.pool.query(
    `SELECT v.*, p.whatsapp_e164, p.preferred_channel, p.display_name
     FROM professional_verifications v JOIN professionals p ON p.id = v.professional_id
     WHERE v.id = $1`,
    [verificationId],
  );
  const row = rows[0];
  if (!row) throw new QuoteError(404, 'verification not found');
  if (row.status === 'REJECTED') throw new QuoteError(409, 'verification was rejected');

  const otp = row.evidence?.otp as { hash: string; expiresAt: string } | undefined;
  const now = deps.now();
  if (!otp || hashOtp(code) !== otp.hash) throw new QuoteError(422, 'invalid code');
  if (new Date(otp.expiresAt).getTime() <= now.getTime()) throw new QuoteError(422, 'code expired; resubmit to get a new one');

  await deps.pool.query(`UPDATE professional_verifications SET whatsapp_otp_passed = true WHERE id = $1`, [verificationId]);

  // All automated checks green? Then this OTP completes verification.
  const strongMatch = row.registry_name !== null && Number(row.name_match_score) >= NAME_MATCH_THRESHOLD;
  if (row.status === 'PENDING_VERIFICATION' && row.checked_at && strongMatch) {
    await finalizeApproval(deps, verificationId, row.professional_id, null);
    return { verificationId, status: 'VERIFIED' };
  }
  return { verificationId, status: row.status };
}

export async function decideVerification(
  deps: AppDeps,
  verificationId: string,
  decision: 'approve' | 'reject',
  reviewedBy: string,
): Promise<VerificationResult> {
  const { rows } = await deps.pool.query(
    `SELECT v.id, v.professional_id, v.status, v.whatsapp_otp_passed, v.registry
     FROM professional_verifications v WHERE v.id = $1`,
    [verificationId],
  );
  const row = rows[0];
  if (!row) throw new QuoteError(404, 'verification not found');
  if (row.status !== 'NEEDS_MANUAL_REVIEW') throw new QuoteError(409, `verification is ${row.status}, not reviewable`);

  if (decision === 'approve') {
    // Number ownership is non-negotiable even when a human vouches for the
    // registry match.
    if (!row.whatsapp_otp_passed) throw new QuoteError(422, 'WhatsApp OTP not confirmed yet');
    await finalizeApproval(deps, verificationId, row.professional_id, reviewedBy);
    return { verificationId, status: 'VERIFIED' };
  }

  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE professional_verifications SET status = 'REJECTED', reviewed_by = $2 WHERE id = $1`,
      [verificationId, reviewedBy],
    );
    await client.query(`UPDATE professionals SET verification_status = 'REJECTED' WHERE id = $1`, [row.professional_id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const professional = await loadProfessional(deps, row.professional_id);
  await notify(deps, professional, verificationId, 'VERIFICATION_REJECTED', { registry: row.registry, attemptsLeft: 0 });
  return { verificationId, status: 'REJECTED' };
}

export async function pendingVerifications(deps: AppDeps): Promise<unknown[]> {
  const { rows } = await deps.pool.query(
    `SELECT v.id, v.professional_id, p.display_name, v.registry, v.registration_number,
            v.submitted_name, v.registry_name, v.name_match_score, v.whatsapp_otp_passed,
            v.evidence, v.created_at
     FROM professional_verifications v
     JOIN professionals p ON p.id = v.professional_id
     WHERE v.status = 'NEEDS_MANUAL_REVIEW'
     ORDER BY v.created_at`,
  );
  return rows;
}

async function finalizeApproval(deps: AppDeps, verificationId: string, professionalId: string, reviewedBy: string | null): Promise<void> {
  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE professional_verifications SET status = 'VERIFIED', reviewed_by = $2 WHERE id = $1`,
      [verificationId, reviewedBy],
    );
    await client.query(`UPDATE professionals SET verification_status = 'VERIFIED' WHERE id = $1`, [professionalId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const professional = await loadProfessional(deps, professionalId);
  await notify(deps, professional, verificationId, 'VERIFICATION_APPROVED', { displayName: professional.display_name });
}

async function loadProfessional(deps: AppDeps, id: string): Promise<{ whatsapp_e164: string; preferred_channel: string; display_name: string }> {
  const { rows } = await deps.pool.query(
    `SELECT whatsapp_e164, preferred_channel, display_name FROM professionals WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function notify(
  deps: AppDeps,
  professional: { whatsapp_e164: string; preferred_channel: string },
  verificationId: string,
  templateKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await deps.pool.query(
    `INSERT INTO outbox_messages (request_id, channel, recipient, template_key, payload, idempotency_key)
     VALUES (NULL, $1, $2, $3, $4, $5) ON CONFLICT (idempotency_key) DO NOTHING`,
    [professional.preferred_channel, professional.whatsapp_e164, templateKey, JSON.stringify(payload), `verification:${verificationId}:${templateKey}`],
  );
}
