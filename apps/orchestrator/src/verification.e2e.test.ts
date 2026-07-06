import {
  dispatchOutbox,
  FakeMessagingPort,
  FakePaymentsPort,
  FakeRegistryPort,
  FakeRoomsPort,
  FakeSchedulingPort,
  renderTemplate,
} from '@marketplace/core';
import { ensureSchema, testPool, truncateAll } from '@marketplace/core/test-helpers';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDeps } from './deps.js';
import { buildServer } from './server.js';

const SECRET = 'e2e-shared-secret-16chars';
const T0 = new Date('2026-08-03T08:00:00Z');

let pool: Pool;
let app: FastifyInstance;
let deps: AppDeps;
let registry: FakeRegistryPort;
let messaging: FakeMessagingPort;
let clock: { now: Date };
let professionalId: string;
let clientId: string;

beforeAll(async () => {
  pool = testPool();
  await ensureSchema(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
  registry = new FakeRegistryPort();
  messaging = new FakeMessagingPort();
  clock = { now: T0 };
  deps = {
    pool,
    scheduling: new FakeSchedulingPort(),
    payments: new FakePaymentsPort(),
    rooms: new FakeRoomsPort(),
    registry,
    pricing: { defaults: { IN_HOURS: '2000.00', OFF_DUTY: '3500.00', OFF_DAY: '5000.00', PREMIUM_INTERRUPT: '8000.00' }, overrides: {} },
    sharedSecret: SECRET,
    now: () => clock.now,
  };
  app = buildServer(deps);

  // Unverified on purpose — that's what this suite is about.
  const prof = await pool.query(
    `INSERT INTO professionals (display_name, whatsapp_e164, calcom_user_id, calcom_event_type, payout_method)
     VALUES ('Dr John Kamau', '+254700000010', 8, 22, '{"type":"MPESA"}') RETURNING id`,
  );
  professionalId = prof.rows[0].id;
  const client = await pool.query(
    `INSERT INTO clients (display_name, phone_e164, email) VALUES ('Brian', '+254711000002', 'brian@example.com') RETURNING id`,
  );
  clientId = client.rows[0].id;
});

afterEach(async () => {
  await app.close();
});

// ---------- helpers ----------

async function submit(overrides: Partial<{ registrationNumber: string; submittedName: string }> = {}) {
  return app.inject({
    method: 'POST',
    url: `/professionals/${professionalId}/verifications`,
    payload: {
      registry: 'KMPDC',
      registrationNumber: overrides.registrationNumber ?? 'A12345',
      submittedName: overrides.submittedName ?? 'Dr John Kamau',
    },
  });
}

async function sentOtpCode(): Promise<string> {
  await dispatchOutbox(pool, messaging, renderTemplate, { now: clock.now });
  const otpMsg = [...messaging.sent].reverse().find((m) => m.body.includes('verification code'));
  const match = otpMsg?.body.match(/code is (\d{6})/);
  if (!match) throw new Error('no OTP message sent');
  return match[1]!;
}

async function profStatus(): Promise<string> {
  const { rows } = await pool.query(`SELECT verification_status FROM professionals WHERE id = $1`, [professionalId]);
  return rows[0].verification_status;
}

async function quoteAttempt(): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/quotes',
    payload: {
      clientId,
      professionalId,
      sessionStart: '2026-08-03T14:00:00Z',
      durationMinutes: 60,
      brief: 'test',
    },
  });
  return res.statusCode;
}

// ---------- tests ----------

describe('hard gate at quote time', () => {
  it('excludes non-verified professionals from the client-facing listing', async () => {
    const before = await app.inject({ method: 'GET', url: '/professionals' });
    expect(before.json().professionals).toEqual([]);

    await pool.query(`UPDATE professionals SET verification_status = 'VERIFIED' WHERE id = $1`, [professionalId]);
    const after = await app.inject({ method: 'GET', url: '/professionals' });
    expect(after.json().professionals).toEqual([
      {
        id: professionalId,
        display_name: 'Dr John Kamau',
        business_name: null,
        provider_type: 'PROFESSIONAL',
        category: 'LECTURER',
        affiliation: null,
        title: null,
        bio: null,
        is_available: true,
        location_area: null,
      },
    ]);

    await pool.query(`UPDATE professionals SET is_active = false WHERE id = $1`, [professionalId]);
    const inactive = await app.inject({ method: 'GET', url: '/professionals' });
    expect(inactive.json().professionals).toEqual([]);
  });

  it('rejects quotes for any professional that is not VERIFIED', async () => {
    expect(await quoteAttempt()).toBe(422); // PENDING_VERIFICATION

    await pool.query(`UPDATE professionals SET verification_status = 'NEEDS_MANUAL_REVIEW' WHERE id = $1`, [professionalId]);
    expect(await quoteAttempt()).toBe(422);

    await pool.query(`UPDATE professionals SET verification_status = 'REJECTED' WHERE id = $1`, [professionalId]);
    expect(await quoteAttempt()).toBe(422);

    await pool.query(`UPDATE professionals SET verification_status = 'VERIFIED' WHERE id = $1`, [professionalId]);
    expect(await quoteAttempt()).toBe(201);
  });
});

describe('automated pipeline', () => {
  it('registry match + OTP -> VERIFIED, with welcome notification', async () => {
    registry.register('KMPDC', 'A12345', 'John Mwangi Kamau'); // honorific dropped, middle name extra

    const res = await submit();
    expect(res.statusCode).toBe(201);
    const { verificationId, status } = res.json();
    expect(status).toBe('PENDING_VERIFICATION'); // strong match, waiting on OTP

    const code = await sentOtpCode();
    const otpRes = await app.inject({ method: 'POST', url: `/verifications/${verificationId}/otp`, payload: { code } });
    expect(otpRes.statusCode).toBe(200);
    expect(otpRes.json().status).toBe('VERIFIED');

    expect(await profStatus()).toBe('VERIFIED');
    expect(await quoteAttempt()).toBe(201);

    await dispatchOutbox(pool, messaging, renderTemplate, { now: clock.now });
    expect(messaging.sent.some((m) => m.body.includes('you can now receive session requests'))).toBe(true);
  });

  it('OTP is required even when the registry match is perfect', async () => {
    registry.register('KMPDC', 'A12345', 'Dr John Kamau'); // exact

    const res = await submit();
    expect(res.json().status).toBe('PENDING_VERIFICATION');
    expect(await profStatus()).toBe('PENDING_VERIFICATION');
    expect(await quoteAttempt()).toBe(422); // still unbookable

    const wrongOtp = await app.inject({
      method: 'POST',
      url: `/verifications/${res.json().verificationId}/otp`,
      payload: { code: '000000' },
    });
    expect(wrongOtp.statusCode).toBe(422);
    expect(await profStatus()).toBe('PENDING_VERIFICATION');
  });

  it('registry not-found -> REJECTED with resubmission invite; 3 strikes exhausts', async () => {
    // Attempt 1 and 2: wrong number, rejected but resubmittable.
    for (const attemptsLeft of [2, 1]) {
      const res = await submit({ registrationNumber: 'WRONG' });
      expect(res.json().status).toBe('REJECTED');
      await dispatchOutbox(pool, messaging, renderTemplate, { now: clock.now });
      expect(messaging.sent.at(-1)!.body).toContain(`${attemptsLeft} attempt`);
      expect(await profStatus()).toBe('PENDING_VERIFICATION'); // can still retry
    }

    // Attempt 3: final strike marks the professional REJECTED.
    const third = await submit({ registrationNumber: 'STILL_WRONG' });
    expect(third.json().status).toBe('REJECTED');
    expect(await profStatus()).toBe('REJECTED');

    // Attempt 4: refused outright.
    const fourth = await submit({ registrationNumber: 'A12345' });
    expect(fourth.statusCode).toBe(422);
    expect(fourth.json().error).toContain('maximum verification attempts');
  });

  it('a correct resubmission after rejection verifies normally', async () => {
    await submit({ registrationNumber: 'WRONG' });
    registry.register('KMPDC', 'A12345', 'John Kamau');

    const retry = await submit();
    expect(retry.json().status).toBe('PENDING_VERIFICATION');
    const code = await sentOtpCode();
    await app.inject({ method: 'POST', url: `/verifications/${retry.json().verificationId}/otp`, payload: { code } });
    expect(await profStatus()).toBe('VERIFIED');
  });

  it('scraper failure -> NEEDS_MANUAL_REVIEW, never stranded in PENDING_VERIFICATION', async () => {
    registry.failNextLookups = 1;

    const res = await submit();
    expect(res.json().status).toBe('NEEDS_MANUAL_REVIEW');
    const { rows } = await pool.query(`SELECT status, evidence FROM professional_verifications WHERE id = $1`, [
      res.json().verificationId,
    ]);
    expect(rows[0].status).toBe('NEEDS_MANUAL_REVIEW');
    expect(rows[0].evidence.outcome).toBe('LOOKUP_ERROR');

    await dispatchOutbox(pool, messaging, renderTemplate, { now: clock.now });
    expect(messaging.sent.some((m) => m.body.includes('1 business day'))).toBe(true);
  });

  it('ambiguous name match -> NEEDS_MANUAL_REVIEW', async () => {
    registry.register('KMPDC', 'A12345', 'Jane Wanjiku Otieno');
    const res = await submit();
    expect(res.json().status).toBe('NEEDS_MANUAL_REVIEW');
  });
});

describe('manual review queue', () => {
  async function submitForReview(): Promise<string> {
    registry.failNextLookups = 1;
    const res = await submit();
    return res.json().verificationId;
  }

  it('endpoints require the shared secret', async () => {
    expect((await app.inject({ method: 'GET', url: '/internal/verifications/pending' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/verifications/x/decide',
          payload: { decision: 'approve', reviewedBy: 'ops@example.com' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('lists pending reviews', async () => {
    const id = await submitForReview();
    const res = await app.inject({
      method: 'GET',
      url: '/internal/verifications/pending',
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.json().pending.map((p: { id: string }) => p.id)).toEqual([id]);
  });

  it('approve requires the OTP, then verifies and records the reviewer', async () => {
    const id = await submitForReview();

    const early = await app.inject({
      method: 'POST',
      url: `/internal/verifications/${id}/decide`,
      headers: { 'x-internal-secret': SECRET },
      payload: { decision: 'approve', reviewedBy: 'ops@example.com' },
    });
    expect(early.statusCode).toBe(422); // OTP not confirmed yet

    const code = await sentOtpCode();
    await app.inject({ method: 'POST', url: `/verifications/${id}/otp`, payload: { code } });

    const res = await app.inject({
      method: 'POST',
      url: `/internal/verifications/${id}/decide`,
      headers: { 'x-internal-secret': SECRET },
      payload: { decision: 'approve', reviewedBy: 'ops@example.com' },
    });
    expect(res.json().status).toBe('VERIFIED');
    expect(await profStatus()).toBe('VERIFIED');

    const { rows } = await pool.query(`SELECT status, reviewed_by FROM professional_verifications WHERE id = $1`, [id]);
    expect(rows[0]).toEqual({ status: 'VERIFIED', reviewed_by: 'ops@example.com' });
  });

  it('reject updates both tables atomically and notifies', async () => {
    const id = await submitForReview();
    const res = await app.inject({
      method: 'POST',
      url: `/internal/verifications/${id}/decide`,
      headers: { 'x-internal-secret': SECRET },
      payload: { decision: 'reject', reviewedBy: 'ops@example.com' },
    });
    expect(res.json().status).toBe('REJECTED');
    expect(await profStatus()).toBe('REJECTED');
    const { rows } = await pool.query(`SELECT reviewed_by FROM professional_verifications WHERE id = $1`, [id]);
    expect(rows[0].reviewed_by).toBe('ops@example.com');

    // Deciding twice is refused.
    const again = await app.inject({
      method: 'POST',
      url: `/internal/verifications/${id}/decide`,
      headers: { 'x-internal-secret': SECRET },
      payload: { decision: 'approve', reviewedBy: 'ops@example.com' },
    });
    expect(again.statusCode).toBe(409);
  });
});
