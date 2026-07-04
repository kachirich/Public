import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeMessagingPort } from '../fakes/messaging.js';
import { dispatchOutbox } from '../outbox/dispatcher.js';
import { transition } from '../state/transition.js';
import { ensureSchema, seedRequest, testPool, truncateAll } from '../test-helpers/db.js';
import { PHASE3_HANDLERS } from './handlers.js';
import { pollTimers } from './poller.js';

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

async function seedJob(requestId: string, jobType: string, runAt = new Date(Date.now() - 1000)): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO scheduled_jobs (request_id, job_type, run_at) VALUES ($1, $2, $3) RETURNING id`,
    [requestId, jobType, runAt],
  );
  return rows[0].id;
}

async function jobStatus(id: string) {
  const { rows } = await pool.query(`SELECT status, fired_at FROM scheduled_jobs WHERE id = $1`, [id]);
  return rows[0];
}

async function requestState(id: string): Promise<string> {
  const { rows } = await pool.query(`SELECT state FROM requests WHERE id = $1`, [id]);
  return rows[0].state;
}

describe('pollTimers', () => {
  it('CARD_EXPIRY on a still-HELD request expires it', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');
    const jobId = await seedJob(requestId, 'CARD_EXPIRY');

    const result = await pollTimers(pool, PHASE3_HANDLERS);

    expect(result).toEqual({ done: 1, skipped: 0 });
    expect((await jobStatus(jobId)).status).toBe('DONE');
    expect(await requestState(requestId)).toBe('EXPIRED');
  });

  it('timer firing after the state moved on = SKIPPED, no message sent', async () => {
    // The spec's phase 3 test: card expiry job exists, but the professional
    // accepted before it fired. The job must be SKIPPED, the request stays
    // ACCEPTED, and no expiry-related message reaches the outbox or the port.
    const { requestId } = await seedRequest(pool, 'HELD');
    const jobId = await seedJob(requestId, 'CARD_EXPIRY');
    await transition(pool, requestId, 'ACCEPTED', 'PROFESSIONAL', 'ACCEPT');
    const { rows: before } = await pool.query(`SELECT count(*)::int AS n FROM outbox_messages`);

    const result = await pollTimers(pool, PHASE3_HANDLERS);

    expect(result).toEqual({ done: 0, skipped: 1 });
    expect((await jobStatus(jobId)).status).toBe('SKIPPED');
    expect(await requestState(requestId)).toBe('ACCEPTED');

    // No new outbox rows from the skipped timer...
    const { rows: after } = await pool.query(`SELECT count(*)::int AS n FROM outbox_messages`);
    expect(after[0].n).toBe(before[0].n);

    // ...and dispatching what does exist sends only the ACCEPTED templates.
    const messaging = new FakeMessagingPort();
    await dispatchOutbox(pool, messaging, (key) => key);
    expect(messaging.sent.map((m) => m.body).sort()).toEqual(['ACCEPTED_CLIENT', 'ACCEPTED_PROFESSIONAL']);
  });

  it('CARD_REMINDER while still HELD enqueues exactly one reminder, idempotently', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');
    const jobId = await seedJob(requestId, 'CARD_REMINDER');

    const result = await pollTimers(pool, PHASE3_HANDLERS);
    expect(result).toEqual({ done: 1, skipped: 0 });
    expect((await jobStatus(jobId)).status).toBe('DONE');

    const { rows } = await pool.query(
      `SELECT template_key, recipient FROM outbox_messages WHERE request_id = $1`,
      [requestId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].template_key).toBe('CARD_REMINDER');

    // A second tick finds no SCHEDULED job; nothing new is queued.
    const again = await pollTimers(pool, PHASE3_HANDLERS);
    expect(again).toEqual({ done: 0, skipped: 0 });
    const { rows: rows2 } = await pool.query(`SELECT count(*)::int AS n FROM outbox_messages WHERE request_id = $1`, [requestId]);
    expect(rows2[0].n).toBe(1);
  });

  it('CARD_REMINDER after the professional declined is SKIPPED with no message', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');
    const jobId = await seedJob(requestId, 'CARD_REMINDER');
    await transition(pool, requestId, 'DECLINED', 'PROFESSIONAL', null);

    const result = await pollTimers(pool, PHASE3_HANDLERS);
    expect(result).toEqual({ done: 0, skipped: 1 });
    expect((await jobStatus(jobId)).status).toBe('SKIPPED');

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM outbox_messages WHERE request_id = $1 AND template_key = 'CARD_REMINDER'`,
      [requestId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('COUNTER_EXPIRY on a still-COUNTER_OFFERED request expires it; SKIPPED once accepted', async () => {
    const stillWaiting = await seedRequest(pool, 'COUNTER_OFFERED');
    const waitingJob = await seedJob(stillWaiting.requestId, 'COUNTER_EXPIRY');

    const accepted = await seedRequest(pool, 'COUNTER_OFFERED');
    const acceptedJob = await seedJob(accepted.requestId, 'COUNTER_EXPIRY');
    await transition(pool, accepted.requestId, 'ACCEPTED', 'CLIENT', 'COUNTER_SLOT_CHOSEN');

    const result = await pollTimers(pool, PHASE3_HANDLERS);

    expect(result).toEqual({ done: 1, skipped: 1 });
    expect((await jobStatus(waitingJob)).status).toBe('DONE');
    expect(await requestState(stillWaiting.requestId)).toBe('EXPIRED');
    expect((await jobStatus(acceptedJob)).status).toBe('SKIPPED');
    expect(await requestState(accepted.requestId)).toBe('ACCEPTED');
  });

  it('future jobs and job types without a registered handler are left untouched', async () => {
    const { requestId } = await seedRequest(pool, 'ACCEPTED');
    const future = await seedJob(requestId, 'CARD_EXPIRY', new Date(Date.now() + 3600_000));
    const unregistered = await seedJob(requestId, 'ROOM_OPEN');

    const result = await pollTimers(pool, PHASE3_HANDLERS);

    expect(result).toEqual({ done: 0, skipped: 0 });
    expect((await jobStatus(future)).status).toBe('SCHEDULED');
    expect((await jobStatus(unregistered)).status).toBe('SCHEDULED');
  });

  it('two concurrent pollers never double-fire a job', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');
    await seedJob(requestId, 'CARD_EXPIRY');

    const [a, b] = await Promise.all([
      pollTimers(pool, PHASE3_HANDLERS),
      pollTimers(pool, PHASE3_HANDLERS),
    ]);

    // SKIP LOCKED means one poller claims the job, the other sees nothing.
    expect(a.done + a.skipped + b.done + b.skipped).toBe(1);
    expect(await requestState(requestId)).toBe('EXPIRED');
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM request_transitions WHERE request_id = $1`, [requestId]);
    expect(rows[0].n).toBe(1);
  });
});
