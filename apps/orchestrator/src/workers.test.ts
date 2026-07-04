import { FakeMessagingPort } from '@marketplace/core';
import { ensureSchema, seedRequest, testPool, truncateAll } from '@marketplace/core/test-helpers';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorkers, type RunningWorkers } from './workers.js';

// End-to-end over real Redis + Postgres: BullMQ heartbeat -> dispatchOutbox
// -> FakeMessagingPort. Requires DATABASE_URL and REDIS_URL (both provided
// in CI; locally spin up containers).
const REDIS_URL = process.env.REDIS_URL;
const describeIf = REDIS_URL && process.env.DATABASE_URL ? describe : describe.skip;

describeIf('startWorkers (integration)', () => {
  let pool: Pool;
  let workers: RunningWorkers;

  beforeAll(async () => {
    pool = testPool();
    await ensureSchema(pool);
    await truncateAll(pool);
  });

  afterAll(async () => {
    await workers?.close();
    await pool.end();
  });

  it('ticks the outbox dispatcher until a pending row is sent', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');
    await pool.query(
      `INSERT INTO outbox_messages (request_id, channel, recipient, template_key, payload, idempotency_key)
       VALUES ($1, 'WHATSAPP', '+254700000099', 'REQUEST_CARD', '{"refCode":"R9"}', 'workers-test-1')`,
      [requestId],
    );

    const messaging = new FakeMessagingPort();
    workers = await startWorkers({
      pool,
      messaging,
      render: (key) => `rendered:${key}`,
      redisUrl: REDIS_URL!,
      tickMs: 1000,
    });

    await expect
      .poll(
        async () => {
          const { rows } = await pool.query(`SELECT status FROM outbox_messages WHERE idempotency_key = 'workers-test-1'`);
          return rows[0].status;
        },
        { timeout: 15_000, interval: 250 },
      )
      .toBe('SENT');

    expect(messaging.sent).toEqual([
      { channel: 'WHATSAPP', recipient: '+254700000099', body: 'rendered:REQUEST_CARD' },
    ]);
  }, 20_000);
});
