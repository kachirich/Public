import {
  FakeMessagingPort,
  FakePaymentsPort,
  FakeRegistryPort,
  FakeRoomsPort,
  FakeSchedulingPort,
} from '@marketplace/core';
import { ensureSchema, testPool, truncateAll } from '@marketplace/core/test-helpers';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDeps } from './deps.js';
import { buildServer } from './server.js';

// SERVICE providers: light registration, fluid multi-capacity windows, flat
// STANDARD pricing, no Cal.com. The professional path has its own suite
// (e2e.test.ts) and must stay byte-for-byte identical.

const SECRET = 'e2e-shared-secret-16chars';
const T0 = new Date('2026-08-03T08:00:00Z'); // a Monday (UTC weekday 1)
const WHATSAPP = '+254700000099';

let pool: Pool;
let app: FastifyInstance;
let deps: AppDeps;
let scheduling: FakeSchedulingPort;
let payments: FakePaymentsPort;
let clock: { now: Date };
let providerId: string;
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
  scheduling = new FakeSchedulingPort();
  payments = new FakePaymentsPort();
  clock = { now: T0 };
  deps = {
    pool,
    scheduling,
    payments,
    rooms: new FakeRoomsPort(),
    registry: new FakeRegistryPort(),
    pricing: {
      defaults: { IN_HOURS: '2000.00', OFF_DUTY: '3500.00', OFF_DAY: '5000.00', PREMIUM_INTERRUPT: '8000.00' },
      overrides: {},
    },
    sharedSecret: SECRET,
    now: () => clock.now,
  };
  app = buildServer(deps);

  const client = await pool.query(
    `INSERT INTO clients (display_name, phone_e164, email) VALUES ('Brian', '+254711000002', 'brian@example.com') RETURNING id`,
  );
  clientId = client.rows[0].id;

  // Register + OTP-verify the service provider, then open two Monday
  // windows: 09:00–13:00 (capacity 2) and 14:00–17:00 (capacity 1).
  const regRes = await app.inject({
    method: 'POST',
    url: '/pro/register',
    payload: { displayName: 'Jane', businessName: "Jane's Salon", whatsapp: WHATSAPP, flatPrice: '800.00' },
  });
  expect(regRes.statusCode).toBe(201);
  const reg = regRes.json();
  providerId = reg.providerId;

  const verifyRes = await app.inject({
    method: 'POST',
    url: '/pro/login/verify',
    payload: { challengeId: reg.challengeId, code: reg.devCode },
  });
  expect(verifyRes.statusCode).toBe(200);
  expect(verifyRes.json().professional.provider_type).toBe('SERVICE');

  const availRes = await app.inject({
    method: 'PUT',
    url: `/pro/${providerId}/availability`,
    payload: {
      consent: true,
      slots: [
        { weekday: 1, startMinute: 9 * 60, endMinute: 13 * 60, capacity: 2 },
        { weekday: 1, startMinute: 14 * 60, endMinute: 17 * 60, capacity: 1 },
      ],
    },
  });
  expect(availRes.statusCode).toBe(200);
});

afterEach(async () => {
  await app.close();
});

// ---------- helpers ----------

async function quote(sessionStartIso: string, durationMinutes = 60) {
  return app.inject({
    method: 'POST',
    url: '/quotes',
    payload: { clientId, professionalId: providerId, sessionStart: sessionStartIso, durationMinutes, brief: 'trim' },
  });
}

async function payAndConfirm(requestId: string): Promise<void> {
  const payRes = await app.inject({ method: 'POST', url: `/quotes/${requestId}/pay` });
  expect(payRes.statusCode).toBe(200);
  const webhookRes = await app.inject({
    method: 'POST',
    url: '/webhooks/paystack',
    headers: { 'x-paystack-signature': payments.validSignature },
    payload: { event: 'charge.success', data: { id: `evt-${requestId}`, reference: `req-${requestId}` } },
  });
  expect(webhookRes.statusCode).toBe(200);
}

let waSeq = 0;
async function waReply(body: string): Promise<string> {
  waSeq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/internal/wa-inbound',
    headers: { 'x-internal-secret': SECRET },
    payload: { waMessageId: `wa-svc-${waSeq}`, fromE164: WHATSAPP, body },
  });
  expect(res.statusCode).toBe(200);
  return res.json().outcome;
}

async function state(requestId: string): Promise<string> {
  const { rows } = await pool.query(`SELECT state FROM requests WHERE id = $1`, [requestId]);
  return rows[0].state;
}

// ---------- the paths ----------

describe('registration and listing', () => {
  it('lists the provider publicly despite PENDING_VERIFICATION', async () => {
    const { rows } = await pool.query(`SELECT verification_status FROM professionals WHERE id = $1`, [providerId]);
    expect(rows[0].verification_status).not.toBe('VERIFIED');

    const res = await app.inject({ method: 'GET', url: '/professionals' });
    const listed = res.json().professionals.find((p: { id: string }) => p.id === providerId);
    expect(listed).toBeDefined();
    expect(listed.business_name).toBe("Jane's Salon");
    expect(listed.provider_type).toBe('SERVICE');
  });

  it('rejects duplicate registration for the same WhatsApp number', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/pro/register',
      payload: { displayName: 'Jane 2', businessName: 'Copycat', whatsapp: WHATSAPP },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns capacity on the availability read and rejects overlapping windows', async () => {
    const getRes = await app.inject({ method: 'GET', url: `/pro/${providerId}/availability` });
    expect(getRes.json().slots).toEqual([
      { weekday: 1, startMinute: 540, endMinute: 780, capacity: 2 },
      { weekday: 1, startMinute: 840, endMinute: 1020, capacity: 1 },
    ]);

    const overlapRes = await app.inject({
      method: 'PUT',
      url: `/pro/${providerId}/availability`,
      payload: {
        consent: true,
        slots: [
          { weekday: 1, startMinute: 540, endMinute: 780, capacity: 2 },
          { weekday: 1, startMinute: 700, endMinute: 900, capacity: 1 },
        ],
      },
    });
    expect(overlapRes.statusCode).toBe(422);
  });
});

describe('booking into a capacity window', () => {
  it('books flat-priced STANDARD requests until the window is full, with no Cal.com booking', async () => {
    // First booking: 10:00–11:00 inside the capacity-2 window.
    const q1 = await quote('2026-08-03T10:00:00Z');
    expect(q1.statusCode).toBe(201);
    const quote1 = q1.json();
    expect(quote1.tier).toBe('STANDARD');
    expect(quote1.priceGross).toBe('800.00');

    await payAndConfirm(quote1.requestId);
    expect(await state(quote1.requestId)).toBe('HELD');
    expect(await waReply('1')).toBe('ACCEPTED');
    expect(await state(quote1.requestId)).toBe('ACCEPTED');
    expect(scheduling.bookings).toHaveLength(0); // never touches Cal.com
    const { rows } = await pool.query(`SELECT calcom_booking_id, tier FROM requests WHERE id = $1`, [quote1.requestId]);
    expect(rows[0].calcom_booking_id).toBeNull();
    expect(rows[0].tier).toBe('STANDARD');

    // Second overlapping booking still fits (capacity 2).
    const q2 = await quote('2026-08-03T10:30:00Z');
    expect(q2.statusCode).toBe(201);
    await payAndConfirm(q2.json().requestId);
    expect(await state(q2.json().requestId)).toBe('HELD');

    // Third overlapping quote: the window is full.
    const q3 = await quote('2026-08-03T10:15:00Z');
    expect(q3.statusCode).toBe(409);

    // A back-to-back booking (11:00, after the first ends) only overlaps the
    // HELD one, so it is admitted.
    const q4 = await quote('2026-08-03T11:00:00Z');
    expect(q4.statusCode).toBe(201);
  });

  it('rejects out-of-window and gap times with 422', async () => {
    expect((await quote('2026-08-03T13:30:00Z')).statusCode).toBe(422); // gap between windows
    expect((await quote('2026-08-04T10:00:00Z')).statusCode).toBe(422); // Tuesday: closed
    expect((await quote('2026-08-03T12:30:00Z')).statusCode).toBe(422); // spills past 13:00
  });

  it('re-checks capacity at payment time so two quotes cannot both fill the last spot', async () => {
    // The 14:00 window has capacity 1. Two quotes are fine (a quote is not a
    // reservation)...
    const a = await quote('2026-08-03T14:00:00Z');
    const b = await quote('2026-08-03T14:30:00Z');
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);

    // ...but only the first can start paying; the second is bounced at init.
    await payAndConfirm(a.json().requestId);
    const payB = await app.inject({ method: 'POST', url: `/quotes/${b.json().requestId}/pay` });
    expect(payB.statusCode).toBe(409);
  });

  it('declines instead of starting a counter-offer flow', async () => {
    const q = await quote('2026-08-03T10:00:00Z');
    await payAndConfirm(q.json().requestId);
    expect(await waReply('3')).toBe('DECLINED'); // "suggest another time" -> plain decline
    expect(await state(q.json().requestId)).toBe('DECLINED');
    const { rows } = await pool.query(`SELECT 1 FROM counter_offers`);
    expect(rows).toHaveLength(0);
  });

  it('blocks bookings after admin deactivation', async () => {
    await app.inject({
      method: 'PUT',
      url: `/internal/professionals/${providerId}/active`,
      headers: { 'x-internal-secret': SECRET },
      payload: { active: false },
    });
    expect((await quote('2026-08-03T10:00:00Z')).statusCode).toBe(422);
  });
});
