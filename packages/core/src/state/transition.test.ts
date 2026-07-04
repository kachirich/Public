import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema, seedRequest, testPool, truncateAll } from '../test-helpers/db.js';
import { IllegalTransitionError, VersionConflictError, RequestNotFoundError } from './errors.js';
import { transition } from './transition.js';
import { VALID_TRANSITIONS, type RequestState } from './transitions.js';

let pool: Pool;

beforeAll(async () => {
  pool = testPool();
  await ensureSchema(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

async function getRequest(id: string) {
  const { rows } = await pool.query(`SELECT * FROM requests WHERE id = $1`, [id]);
  return rows[0];
}

async function ledgerFor(id: string) {
  const { rows } = await pool.query(
    `SELECT entry_type, amount FROM ledger_entries WHERE request_id = $1 ORDER BY id`,
    [id],
  );
  return rows;
}

async function outboxFor(id: string) {
  const { rows } = await pool.query(
    `SELECT template_key, channel, recipient FROM outbox_messages WHERE request_id = $1 ORDER BY created_at, template_key`,
    [id],
  );
  return rows;
}

async function timersFor(id: string) {
  const { rows } = await pool.query(
    `SELECT job_type, run_at FROM scheduled_jobs WHERE request_id = $1 ORDER BY run_at, job_type`,
    [id],
  );
  return rows;
}

describe('every legal transition', () => {
  for (const [from, targets] of Object.entries(VALID_TRANSITIONS) as [RequestState, readonly RequestState[]][]) {
    for (const to of targets) {
      it(`${from} -> ${to}`, async () => {
        const { requestId } = await seedRequest(pool, from);
        const result = await transition(pool, requestId, to, 'SYSTEM', 'TEST');

        expect(result.fromState).toBe(from);
        expect(result.toState).toBe(to);
        expect(result.version).toBe(1);

        const row = await getRequest(requestId);
        expect(row.state).toBe(to);
        expect(row.version).toBe(1);

        const { rows: audit } = await pool.query(
          `SELECT from_state, to_state, actor, reason_code FROM request_transitions WHERE request_id = $1`,
          [requestId],
        );
        expect(audit).toEqual([{ from_state: from, to_state: to, actor: 'SYSTEM', reason_code: 'TEST' }]);
      });
    }
  }
});

describe('illegal transitions', () => {
  const illegal: [RequestState, RequestState][] = [
    ['REQUESTED', 'ACCEPTED'],
    ['REQUESTED', 'HELD'],
    ['PENDING_PAYMENT', 'ACCEPTED'],
    ['HELD', 'COMPLETED'],
    ['HELD', 'REFUNDED'],
    ['ACCEPTED', 'HELD'],
    ['ACCEPTED', 'REFUNDED'],
    ['COMPLETED', 'REFUNDED'],
    ['REFUNDED', 'HELD'],
    ['CANCELLED', 'PENDING_PAYMENT'],
    ['NO_SHOW_CLIENT', 'REFUNDED'],
    ['COUNTER_OFFERED', 'COUNTER_OFFERED'],
  ];

  for (const [from, to] of illegal) {
    it(`${from} -> ${to} throws and changes nothing`, async () => {
      const { requestId } = await seedRequest(pool, from);
      await expect(transition(pool, requestId, to, 'SYSTEM', 'TEST')).rejects.toThrow(IllegalTransitionError);

      const row = await getRequest(requestId);
      expect(row.state).toBe(from);
      expect(row.version).toBe(0);
      expect(await ledgerFor(requestId)).toEqual([]);
      expect(await outboxFor(requestId)).toEqual([]);
      expect(await timersFor(requestId)).toEqual([]);
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM request_transitions WHERE request_id = $1`, [requestId]);
      expect(rows[0].n).toBe(0);
    });
  }

  it('IllegalTransitionError carries the current state for the caller to answer with', async () => {
    const { requestId } = await seedRequest(pool, 'COMPLETED');
    const err = await transition(pool, requestId, 'REFUNDED', 'SYSTEM', null).catch((e) => e);
    expect(err).toBeInstanceOf(IllegalTransitionError);
    expect(err.currentState).toBe('COMPLETED');
    expect(err.attemptedState).toBe('REFUNDED');
  });

  it('unknown request id throws RequestNotFoundError', async () => {
    await expect(
      transition(pool, '00000000-0000-0000-0000-000000000000', 'HELD', 'SYSTEM', null),
    ).rejects.toThrow(RequestNotFoundError);
  });
});

describe('money rules', () => {
  it('PENDING_PAYMENT -> HELD writes a HOLD for the gross amount', async () => {
    const { requestId } = await seedRequest(pool, 'PENDING_PAYMENT');
    await transition(pool, requestId, 'HELD', 'SYSTEM', 'PAYMENT_CONFIRMED', { providerRef: 'ps_123' });

    expect(await ledgerFor(requestId)).toEqual([{ entry_type: 'HOLD', amount: '1000.00' }]);
    const { rows } = await pool.query(`SELECT provider_ref FROM ledger_entries WHERE request_id = $1`, [requestId]);
    expect(rows[0].provider_ref).toBe('ps_123');
  });

  it('acceptance COMMITs the gross amount', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');
    await transition(pool, requestId, 'ACCEPTED', 'PROFESSIONAL', null);
    expect(await ledgerFor(requestId)).toEqual([{ entry_type: 'COMMIT', amount: '1000.00' }]);
  });

  it('accepted counter-offer in a cheaper tier adds a PARTIAL_REFUND of the difference', async () => {
    const { requestId } = await seedRequest(pool, 'COUNTER_OFFERED');
    await transition(pool, requestId, 'ACCEPTED', 'CLIENT', 'COUNTER_SLOT_CHOSEN', { partialRefundAmount: '250.00' });

    expect(await ledgerFor(requestId)).toEqual([
      { entry_type: 'COMMIT', amount: '1000.00' },
      { entry_type: 'PARTIAL_REFUND', amount: '250.00' },
    ]);
    const outbox = await outboxFor(requestId);
    expect(outbox.map((m) => m.template_key)).toContain('PARTIAL_REFUND_CLIENT');
  });

  it('COMPLETED releases the net payout and recognises the platform fee', async () => {
    const { requestId } = await seedRequest(pool, 'IN_SESSION');
    await transition(pool, requestId, 'COMPLETED', 'TIMER', 'SESSION_END');

    expect(await ledgerFor(requestId)).toEqual([
      { entry_type: 'RELEASE', amount: '850.00' },
      { entry_type: 'PLATFORM_FEE', amount: '150.00' },
    ]);
  });

  it('NO_SHOW_CLIENT pays the professional in full (release + fee, no refund)', async () => {
    const { requestId } = await seedRequest(pool, 'IN_SESSION');
    await transition(pool, requestId, 'NO_SHOW_CLIENT', 'TIMER', 'NO_SHOW_CHECK');

    expect(await ledgerFor(requestId)).toEqual([
      { entry_type: 'RELEASE', amount: '850.00' },
      { entry_type: 'PLATFORM_FEE', amount: '150.00' },
    ]);
  });

  it('REFUNDED writes a full REFUND of the gross amount', async () => {
    const { requestId } = await seedRequest(pool, 'DECLINED');
    await transition(pool, requestId, 'REFUNDED', 'SYSTEM', 'REFUND_CONFIRMED', { providerRef: 'rf_9' });
    expect(await ledgerFor(requestId)).toEqual([{ entry_type: 'REFUND', amount: '1000.00' }]);
  });

  it('DECLINED / EXPIRED / NO_SHOW_PROFESSIONAL write no ledger rows themselves (refund lands on REFUNDED)', async () => {
    for (const to of ['DECLINED', 'EXPIRED'] as const) {
      const { requestId } = await seedRequest(pool, 'HELD');
      await transition(pool, requestId, to, 'PROFESSIONAL', null);
      expect(await ledgerFor(requestId)).toEqual([]);
    }
    const { requestId } = await seedRequest(pool, 'ACCEPTED');
    await transition(pool, requestId, 'NO_SHOW_PROFESSIONAL', 'TIMER', null);
    expect(await ledgerFor(requestId)).toEqual([]);
  });
});

describe('notifications and timers', () => {
  it('HELD sends REQUEST_CARD to the professional and schedules reminder + expiry', async () => {
    const cardExpiresAt = new Date(Date.now() + 4 * 3600_000);
    const now = new Date();
    const { requestId } = await seedRequest(pool, 'PENDING_PAYMENT', { cardExpiresAt });
    await transition(pool, requestId, 'HELD', 'SYSTEM', null, {}, { now });

    const outbox = await outboxFor(requestId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].template_key).toBe('REQUEST_CARD');
    expect(outbox[0].channel).toBe('WHATSAPP');

    const timers = await timersFor(requestId);
    expect(timers.map((t) => t.job_type)).toEqual(['CARD_REMINDER', 'CARD_EXPIRY']);
    const halfway = now.getTime() + (cardExpiresAt.getTime() - now.getTime()) / 2;
    expect(Math.abs(timers[0].run_at.getTime() - halfway)).toBeLessThan(1000);
    expect(timers[1].run_at.getTime()).toBe(cardExpiresAt.getTime());
  });

  it('ACCEPTED notifies both parties and schedules the full session timer set', async () => {
    const sessionStart = new Date('2026-08-01T10:00:00Z');
    const { requestId } = await seedRequest(pool, 'HELD', { sessionStart, durationMinutes: 60 });
    await transition(pool, requestId, 'ACCEPTED', 'PROFESSIONAL', null);

    const outbox = await outboxFor(requestId);
    expect(outbox.map((m) => m.template_key).sort()).toEqual(['ACCEPTED_CLIENT', 'ACCEPTED_PROFESSIONAL']);

    const timers = await timersFor(requestId);
    expect(timers.map((t) => [t.job_type, t.run_at.toISOString()])).toEqual([
      ['ROOM_OPEN', '2026-08-01T09:45:00.000Z'],
      ['NO_SHOW_CHECK', '2026-08-01T10:05:00.000Z'],
      ['NO_SHOW_CHECK', '2026-08-01T10:15:00.000Z'],
      ['SESSION_END_WARNING', '2026-08-01T10:50:00.000Z'],
      ['SESSION_END', '2026-08-01T11:00:00.000Z'],
      ['ROOM_DISSOLVE', '2026-08-01T11:30:00.000Z'],
    ]);
  });

  it('client notifications fall back to WhatsApp when no email is on file', async () => {
    const { requestId } = await seedRequest(pool, 'HELD', { clientEmail: null });
    await transition(pool, requestId, 'DECLINED', 'PROFESSIONAL', null);

    const outbox = await outboxFor(requestId);
    expect(outbox).toEqual([
      expect.objectContaining({ template_key: 'DECLINED_CLIENT', channel: 'WHATSAPP' }),
    ]);
  });

  it('retrying the same logical notification is idempotent via idempotency_key', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');
    const result = await transition(pool, requestId, 'DECLINED', 'PROFESSIONAL', null);
    await pool.query(
      `INSERT INTO outbox_messages (request_id, channel, recipient, template_key, payload, idempotency_key)
       VALUES ($1, 'EMAIL', 'x@example.com', 'DECLINED_CLIENT', '{}', $2)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [requestId, `${requestId}:DECLINED_CLIENT:${result.transitionId}`],
    );
    expect(await outboxFor(requestId)).toHaveLength(1);
  });
});

describe('optimistic locking and concurrency', () => {
  it('expectedVersion mismatch throws VersionConflictError and changes nothing', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');
    await transition(pool, requestId, 'COUNTER_OFFERED', 'PROFESSIONAL', null); // version now 1

    await expect(
      transition(pool, requestId, 'ACCEPTED', 'CLIENT', null, {}, { expectedVersion: 0 }),
    ).rejects.toThrow(VersionConflictError);

    const row = await getRequest(requestId);
    expect(row.state).toBe('COUNTER_OFFERED');
    expect(row.version).toBe(1);
  });

  it('concurrent accept vs expiry: exactly one wins', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');

    const [accept, expire] = await Promise.allSettled([
      transition(pool, requestId, 'ACCEPTED', 'PROFESSIONAL', 'ACCEPT'),
      transition(pool, requestId, 'EXPIRED', 'TIMER', 'CARD_EXPIRY'),
    ]);

    const outcomes = [accept, expire];
    const winners = outcomes.filter((o) => o.status === 'fulfilled');
    const losers = outcomes.filter((o) => o.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as PromiseRejectedResult).reason).toBeInstanceOf(IllegalTransitionError);

    const row = await getRequest(requestId);
    expect(row.version).toBe(1);
    expect(['ACCEPTED', 'EXPIRED']).toContain(row.state);

    // Exactly one audit row, and the ledger reflects only the winner.
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM request_transitions WHERE request_id = $1`, [requestId]);
    expect(rows[0].n).toBe(1);
    const ledger = await ledgerFor(requestId);
    if (row.state === 'ACCEPTED') {
      expect(ledger).toEqual([{ entry_type: 'COMMIT', amount: '1000.00' }]);
    } else {
      expect(ledger).toEqual([]);
    }
  });

  it('serialized re-runs: the loser of the race cannot re-fire later either', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');
    await transition(pool, requestId, 'ACCEPTED', 'PROFESSIONAL', null);
    await expect(transition(pool, requestId, 'EXPIRED', 'TIMER', 'CARD_EXPIRY')).rejects.toThrow(IllegalTransitionError);
  });
});
