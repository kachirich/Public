import {
  dispatchOutbox,
  FakeMessagingPort,
  FakePaymentsPort,
  FakeRoomsPort,
  FakeSchedulingPort,
  pollTimers,
  renderTemplate,
} from '@marketplace/core';
import { ensureSchema, testPool, truncateAll } from '@marketplace/core/test-helpers';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppDeps } from './deps.js';
import { buildServer } from './server.js';
import { buildTimerHandlers } from './timer-handlers.js';

const SECRET = 'e2e-shared-secret-16chars';
const T0 = new Date('2026-08-03T08:00:00Z');

let pool: Pool;
let app: FastifyInstance;
let deps: AppDeps;
let scheduling: FakeSchedulingPort;
let payments: FakePaymentsPort;
let rooms: FakeRoomsPort;
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
  scheduling = new FakeSchedulingPort();
  payments = new FakePaymentsPort();
  rooms = new FakeRoomsPort();
  messaging = new FakeMessagingPort();
  clock = { now: T0 };
  deps = {
    pool,
    scheduling,
    payments,
    rooms,
    pricing: { defaults: { IN_HOURS: '2000.00', OFF_DUTY: '3500.00', OFF_DAY: '5000.00', PREMIUM_INTERRUPT: '8000.00' }, overrides: {} },
    sharedSecret: SECRET,
    now: () => clock.now,
  };
  app = buildServer(deps);

  const prof = await pool.query(
    `INSERT INTO professionals (display_name, whatsapp_e164, calcom_user_id, calcom_event_type, payout_method, fee_percent)
     VALUES ('Dr Achieng', '+254700000001', 7, 21, '{"type":"MPESA"}', 15.00) RETURNING id`,
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

async function advanceTo(when: Date): Promise<void> {
  clock.now = when;
  // Poll until quiet: a fired timer can schedule follow-up work (e.g.
  // DECLINED schedules REFUND_EXECUTE at the same instant).
  for (let i = 0; i < 5; i++) {
    const result = await pollTimers(pool, buildTimerHandlers(deps), { now: when });
    if (result.done + result.skipped === 0) break;
  }
}

async function flushOutbox(): Promise<void> {
  await dispatchOutbox(pool, messaging, renderTemplate, { now: clock.now });
}

async function createPaidRequest(sessionStart: Date, brief = 'Second opinion'): Promise<{ requestId: string; refCode: string }> {
  const quoteRes = await app.inject({
    method: 'POST',
    url: '/quotes',
    payload: { clientId, professionalId, sessionStart: sessionStart.toISOString(), durationMinutes: 60, brief },
  });
  expect(quoteRes.statusCode).toBe(201);
  const quote = quoteRes.json();

  const payRes = await app.inject({ method: 'POST', url: `/quotes/${quote.requestId}/pay` });
  expect(payRes.statusCode).toBe(200);
  expect(payRes.json().authorizationUrl).toContain('https://pay.example/');

  const webhookRes = await app.inject({
    method: 'POST',
    url: '/webhooks/paystack',
    headers: { 'x-paystack-signature': payments.validSignature },
    payload: {
      event: 'charge.success',
      data: { id: `evt-${quote.requestId}`, reference: `req-${quote.requestId}` },
    },
  });
  expect(webhookRes.statusCode).toBe(200);
  return { requestId: quote.requestId, refCode: quote.refCode };
}

let waSeq = 0;
async function waReply(body: string): Promise<string> {
  waSeq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/internal/wa-inbound',
    headers: { 'x-internal-secret': SECRET },
    payload: { waMessageId: `wa-${waSeq}`, fromE164: '+254700000001', body },
  });
  expect(res.statusCode).toBe(200);
  return res.json().outcome;
}

async function state(requestId: string): Promise<string> {
  const { rows } = await pool.query(`SELECT state FROM requests WHERE id = $1`, [requestId]);
  return rows[0].state;
}

async function ledger(requestId: string): Promise<{ entry_type: string; amount: string }[]> {
  const { rows } = await pool.query(
    `SELECT entry_type, amount FROM ledger_entries WHERE request_id = $1 ORDER BY id`,
    [requestId],
  );
  return rows;
}

// ---------- the paths ----------

describe('happy path: quote -> pay -> card -> accept -> room -> complete -> payout -> dissolve', () => {
  it('runs end to end against fakes', async () => {
    const sessionStart = new Date('2026-08-03T14:00:00Z'); // OFF_DUTY (no availability configured)
    const { requestId, refCode } = await createPaidRequest(sessionStart);

    expect(await state(requestId)).toBe('HELD');
    expect(await ledger(requestId)).toEqual([{ entry_type: 'HOLD', amount: '3500.00' }]);

    // Card reaches the professional.
    await flushOutbox();
    const card = messaging.sent.find((m) => m.recipient === '+254700000001');
    expect(card?.body).toContain(`#${refCode}`);
    expect(card?.body).toContain('2975.00'); // NET, not gross
    expect(card?.body).not.toContain('3500.00');

    // Professional accepts with a bare "1".
    expect(await waReply('1')).toBe('ACCEPTED');
    expect(await state(requestId)).toBe('ACCEPTED');
    expect(scheduling.bookings).toHaveLength(1);
    expect(scheduling.bookings[0]!.force).toBe(true); // OFF_DUTY force-books
    const { rows: booked } = await pool.query(`SELECT calcom_booking_id FROM requests WHERE id = $1`, [requestId]);
    expect(booked[0].calcom_booking_id).toBe(scheduling.bookings[0]!.bookingId);

    // T-15min: room opens, session goes live.
    await advanceTo(new Date('2026-08-03T13:45:00Z'));
    expect(await state(requestId)).toBe('IN_SESSION');
    expect(rooms.created).toHaveLength(1);
    expect(rooms.created[0]!.participants).toEqual(['+254700000001', '+254711000002']);
    await flushOutbox();
    expect(messaging.sent.some((m) => m.recipient === rooms.created[0]!.roomId && m.body.includes('Welcome'))).toBe(true);

    // Professional shows up (any inbound message counts as presence).
    await waReply('joined, ready when you are');

    // Through the session: no-show checks pass, end warning fires, session completes.
    await advanceTo(new Date('2026-08-03T15:00:00Z'));
    expect(await state(requestId)).toBe('COMPLETED');
    expect(await ledger(requestId)).toEqual([
      { entry_type: 'HOLD', amount: '3500.00' },
      { entry_type: 'COMMIT', amount: '3500.00' },
      { entry_type: 'RELEASE', amount: '2975.00' },
      { entry_type: 'PLATFORM_FEE', amount: '525.00' },
    ]);

    // end+30min: room dissolves.
    await advanceTo(new Date('2026-08-03T15:30:00Z'));
    expect(rooms.dissolved).toEqual([
      { roomId: rooms.created[0]!.roomId, participants: ['+254700000001', '+254711000002'] },
    ]);
    const { rows } = await pool.query(`SELECT dissolved_at FROM consult_rooms WHERE request_id = $1`, [requestId]);
    expect(rows[0].dissolved_at).not.toBeNull();

    // Payout + rebook notifications went out.
    await flushOutbox();
    expect(messaging.sent.some((m) => m.body.includes('payout of KES 2975.00'))).toBe(true);

    // The client UI sees the full history.
    const reqRes = await app.inject({ method: 'GET', url: `/requests/${requestId}` });
    expect(reqRes.json().transitions.map((t: { to_state: string }) => t.to_state)).toEqual([
      'PENDING_PAYMENT',
      'HELD',
      'ACCEPTED',
      'IN_SESSION',
      'COMPLETED',
    ]);
  });
});

describe('refund paths', () => {
  it('professional declines -> full refund', async () => {
    const { requestId } = await createPaidRequest(new Date('2026-08-03T14:00:00Z'));

    expect(await waReply('2')).toBe('DECLINED');
    expect(await state(requestId)).toBe('DECLINED');

    // The REFUND_EXECUTE timer fires immediately.
    await advanceTo(clock.now);
    expect(await state(requestId)).toBe('REFUNDED');
    expect(payments.refunds).toEqual([
      { providerRef: `req-${requestId}`, amount: '3500.00', refundRef: 'fake-refund-1' },
    ]);
    expect(await ledger(requestId)).toEqual([
      { entry_type: 'HOLD', amount: '3500.00' },
      { entry_type: 'REFUND', amount: '3500.00' },
    ]);

    await flushOutbox();
    expect(messaging.sent.some((m) => m.recipient === 'brian@example.com' && m.body.includes('refunded'))).toBe(true);

    // A late reply after settling gets status + money, and nothing happens twice.
    expect(await waReply('1')).toBe('STATUS_REPLIED');
    expect(await state(requestId)).toBe('REFUNDED');
    await flushOutbox();
    expect(messaging.sent.at(-1)!.body).toContain('fully refunded');
  });

  it('card expires unanswered -> full refund', async () => {
    const { requestId } = await createPaidRequest(new Date('2026-08-03T20:00:00Z'));
    // OFF_DUTY card expiry = 4h after HELD.
    await advanceTo(new Date('2026-08-03T12:00:01Z'));

    expect(await state(requestId)).toBe('REFUNDED');
    expect(payments.refunds).toHaveLength(1);
    expect(await ledger(requestId)).toEqual([
      { entry_type: 'HOLD', amount: '3500.00' },
      { entry_type: 'REFUND', amount: '3500.00' },
    ]);
  });

  it('professional no-show -> nudge at +5, refund at +15', async () => {
    const sessionStart = new Date('2026-08-03T14:00:00Z');
    const { requestId, refCode } = await createPaidRequest(sessionStart);
    await waReply('1');
    await advanceTo(new Date('2026-08-03T13:45:00Z')); // room opens
    expect(await state(requestId)).toBe('IN_SESSION');

    // +5min, professional silent since the room opened -> nudge only.
    await advanceTo(new Date('2026-08-03T14:05:00Z'));
    expect(await state(requestId)).toBe('IN_SESSION');
    await flushOutbox();
    expect(messaging.sent.some((m) => m.body.includes(`Session #${refCode} started 5 minutes ago`))).toBe(true);

    // +15min, still silent -> no-show, refund, no-show counter bumped.
    await advanceTo(new Date('2026-08-03T14:15:00Z'));
    expect(await state(requestId)).toBe('REFUNDED');
    expect(payments.refunds).toHaveLength(1);
    expect(await ledger(requestId)).toEqual([
      { entry_type: 'HOLD', amount: '3500.00' },
      { entry_type: 'COMMIT', amount: '3500.00' },
      { entry_type: 'REFUND', amount: '3500.00' },
    ]);
    const { rows } = await pool.query(`SELECT no_show_count FROM professionals WHERE id = $1`, [professionalId]);
    expect(rows[0].no_show_count).toBe(1);
  });
});

describe('counter-offer path with partial refund', () => {
  it('3 -> slots -> echo -> yes -> client picks a cheaper slot', async () => {
    // Original request lands OFF_DAY (weekend): 5000.00 gross.
    scheduling.workingDays = new Set([1, 2, 3, 4, 5]);
    const { requestId, refCode } = await createPaidRequest(new Date('2026-08-09T14:00:00Z')); // Sunday
    expect((await ledger(requestId))[0]).toEqual({ entry_type: 'HOLD', amount: '5000.00' });

    // Professional: wrong time -> prompted for alternatives.
    expect(await waReply('3')).toBe('COUNTER_STARTED');
    await flushOutbox();
    expect(messaging.sent.at(-1)!.body).toContain('suggest up to 3 alternative times');

    // Sends two weekday-evening alternatives (OFF_DUTY -> 3500.00, cheaper).
    expect(await waReply('Monday 7pm\nTuesday 7pm')).toBe('COUNTER_ECHOED');
    await flushOutbox();
    const echo = messaging.sent.at(-1)!.body;
    expect(echo).toContain('You are proposing these times');
    expect(echo).toContain('Reply YES');

    // Confirms; the client is notified and the offer is created.
    expect(await waReply('yes')).toBe('COUNTER_SENT');
    expect(await state(requestId)).toBe('COUNTER_OFFERED');
    const { rows: offers } = await pool.query(`SELECT id, expires_at FROM counter_offers WHERE request_id = $1`, [requestId]);
    expect(offers).toHaveLength(1);
    const { rows: slots } = await pool.query(
      `SELECT id, tier, price_gross FROM counter_offer_slots WHERE counter_offer_id = $1 ORDER BY slot_start`,
      [offers[0].id],
    );
    expect(slots).toHaveLength(2);
    expect(slots[0].tier).toBe('OFF_DUTY');
    expect(slots[0].price_gross).toBe('3500.00'); // min(5000, 3500)

    await flushOutbox();
    expect(messaging.sent.some((m) => m.recipient === 'brian@example.com' && m.body.includes('proposed alternatives'))).toBe(true);

    // Client picks the first slot -> ACCEPTED with a 1500.00 partial refund.
    const choose = await app.inject({
      method: 'POST',
      url: `/counter-offers/${offers[0].id}/choose`,
      payload: { slotId: slots[0].id },
    });
    expect(choose.statusCode).toBe(200);

    expect(await state(requestId)).toBe('ACCEPTED');
    expect(payments.refunds).toEqual([
      { providerRef: `req-${requestId}`, amount: '1500.00', refundRef: 'fake-refund-1' },
    ]);
    expect(await ledger(requestId)).toEqual([
      { entry_type: 'HOLD', amount: '5000.00' },
      { entry_type: 'COMMIT', amount: '3500.00' },
      { entry_type: 'PARTIAL_REFUND', amount: '1500.00' },
    ]);

    // Request now carries the slot's schedule and pricing; booking created.
    const { rows: req } = await pool.query(
      `SELECT session_start, tier, price_gross, payout_net FROM requests WHERE id = $1`,
      [requestId],
    );
    expect(req[0].tier).toBe('OFF_DUTY');
    expect(req[0].price_gross).toBe('3500.00');
    expect(req[0].payout_net).toBe('2975.00');
    expect(scheduling.bookings).toHaveLength(1);

    await flushOutbox();
    expect(messaging.sent.some((m) => m.body.includes('refunding the KES 1500.00 difference'))).toBe(true);
    expect(messaging.sent.some((m) => m.body.includes(`Confirmed #${refCode}`))).toBe(true);

    // One round only: a second choose is rejected.
    const again = await app.inject({
      method: 'POST',
      url: `/counter-offers/${offers[0].id}/choose`,
      payload: { slotId: slots[1].id },
    });
    expect(again.statusCode).toBe(409);
  });

  it('a counter slot taken meanwhile rejects with 409 and leaves state intact', async () => {
    const { requestId } = await createPaidRequest(new Date('2026-08-09T14:00:00Z'));
    await waReply('3');
    await waReply('Monday 7pm');
    await waReply('yes');

    const { rows: offers } = await pool.query(`SELECT id FROM counter_offers WHERE request_id = $1`, [requestId]);
    const { rows: slots } = await pool.query(
      `SELECT id, slot_start FROM counter_offer_slots WHERE counter_offer_id = $1`,
      [offers[0].id],
    );
    scheduling.takenSlots.add(slots[0].slot_start.getTime());

    const choose = await app.inject({
      method: 'POST',
      url: `/counter-offers/${offers[0].id}/choose`,
      payload: { slotId: slots[0].id },
    });

    expect(choose.statusCode).toBe(409);
    expect(await state(requestId)).toBe('COUNTER_OFFERED');
    expect(payments.refunds).toEqual([]);
  });
});

describe('guardrails', () => {
  it('duplicate paystack webhooks are no-ops', async () => {
    const { requestId } = await createPaidRequest(new Date('2026-08-03T14:00:00Z'));
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/paystack',
      headers: { 'x-paystack-signature': payments.validSignature },
      payload: { event: 'charge.success', data: { id: `evt-${requestId}`, reference: `req-${requestId}` } },
    });
    expect(res.json()).toEqual({ received: true, duplicate: true });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM ledger_entries WHERE request_id = $1 AND entry_type = 'HOLD'`,
      [requestId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('rejects paystack webhooks with a bad signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/paystack',
      headers: { 'x-paystack-signature': 'forged' },
      payload: { event: 'charge.success', data: { id: 'x', reference: 'req-x' } },
    });
    expect(res.statusCode).toBe(401);
  });

  it('duplicate WhatsApp messages are ignored', async () => {
    const { requestId } = await createPaidRequest(new Date('2026-08-03T14:00:00Z'));
    await app.inject({
      method: 'POST',
      url: '/internal/wa-inbound',
      headers: { 'x-internal-secret': SECRET },
      payload: { waMessageId: 'dup-1', fromE164: '+254700000001', body: '2' },
    });
    const dup = await app.inject({
      method: 'POST',
      url: '/internal/wa-inbound',
      headers: { 'x-internal-secret': SECRET },
      payload: { waMessageId: 'dup-1', fromE164: '+254700000001', body: '2' },
    });
    expect(dup.json().outcome).toBe('DUPLICATE');
    expect(await state(requestId)).toBe('DECLINED');
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM request_transitions WHERE request_id = $1 AND to_state = 'DECLINED'`, [requestId]);
    expect(rows[0].n).toBe(1);
  });

  it('wa-inbound requires the shared secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/wa-inbound',
      payload: { waMessageId: 'x', fromE164: '+254700000001', body: '1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('ambiguous bare replies with several pending cards ask which request', async () => {
    await createPaidRequest(new Date('2026-08-03T14:00:00Z'));
    await createPaidRequest(new Date('2026-08-03T16:00:00Z'));

    expect(await waReply('1')).toBe('WHICH_REQUEST');
    await flushOutbox();
    expect(messaging.sent.at(-1)!.body).toContain('Which one do you mean?');

    // Including the ref disambiguates.
    const { rows } = await pool.query(`SELECT id, ref_code FROM requests ORDER BY created_at LIMIT 1`);
    expect(await waReply(`#${rows[0].ref_code} 1`)).toBe('ACCEPTED');
    expect(await state(rows[0].id)).toBe('ACCEPTED');
  });

  it('garbage input gets a gentle re-prompt, never a guess', async () => {
    const { requestId } = await createPaidRequest(new Date('2026-08-03T14:00:00Z'));
    expect(await waReply('asdfgh 🙂')).toBe('REPROMPTED');
    expect(await state(requestId)).toBe('HELD');
    await flushOutbox();
    expect(messaging.sent.at(-1)!.body).toContain("didn't catch that");
  });

  it('quotes for unverified-time PREMIUM_INTERRUPT use the premium price and 15-minute expiry', async () => {
    const start = new Date(T0.getTime() + 30 * 60_000);
    const res = await app.inject({
      method: 'POST',
      url: '/quotes',
      payload: { clientId, professionalId, sessionStart: start.toISOString(), durationMinutes: 30, brief: 'urgent' },
    });
    const quote = res.json();
    expect(quote.tier).toBe('PREMIUM_INTERRUPT');
    expect(quote.priceGross).toBe('8000.00');

    await app.inject({ method: 'POST', url: `/quotes/${quote.requestId}/pay` });
    await app.inject({
      method: 'POST',
      url: '/webhooks/paystack',
      headers: { 'x-paystack-signature': payments.validSignature },
      payload: { event: 'charge.success', data: { id: `evt-${quote.requestId}`, reference: `req-${quote.requestId}` } },
    });
    const { rows } = await pool.query(`SELECT card_expires_at FROM requests WHERE id = $1`, [quote.requestId]);
    expect(rows[0].card_expires_at.getTime()).toBe(T0.getTime() + 15 * 60_000);
  });
});
