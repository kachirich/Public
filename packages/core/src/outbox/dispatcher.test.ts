import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeMessagingPort } from '../fakes/messaging.js';
import { ensureSchema, seedRequest, testPool, truncateAll } from '../test-helpers/db.js';
import { dispatchOutbox, type TemplateRenderer } from './dispatcher.js';

let pool: Pool;
const render: TemplateRenderer = (key, payload) => `[${key}] ${JSON.stringify(payload)}`;

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

async function seedOutboxRow(
  requestId: string,
  overrides: Partial<{ status: string; attempts: number; nextAttemptAt: Date; templateKey: string }> = {},
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO outbox_messages (request_id, channel, recipient, template_key, payload, idempotency_key, status, attempts, next_attempt_at)
     VALUES ($1, 'WHATSAPP', '+254700000000', $2, '{"refCode":"R1"}', $3, $4, $5, $6) RETURNING id`,
    [
      requestId,
      overrides.templateKey ?? 'REQUEST_CARD',
      `key-${Math.random().toString(36).slice(2)}`,
      overrides.status ?? 'PENDING',
      overrides.attempts ?? 0,
      overrides.nextAttemptAt ?? new Date(),
    ],
  );
  return rows[0].id;
}

async function outboxRow(id: string) {
  const { rows } = await pool.query(`SELECT status, attempts, sent_at, next_attempt_at FROM outbox_messages WHERE id = $1`, [id]);
  return rows[0];
}

describe('dispatchOutbox', () => {
  it('sends due pending rows through the port and marks them SENT', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');
    const id = await seedOutboxRow(requestId);
    const messaging = new FakeMessagingPort();

    const result = await dispatchOutbox(pool, messaging, render);

    expect(result).toEqual({ sent: 1, failed: 0, dead: 0 });
    expect(messaging.sent).toEqual([
      { channel: 'WHATSAPP', recipient: '+254700000000', body: '[REQUEST_CARD] {"refCode":"R1"}' },
    ]);
    const row = await outboxRow(id);
    expect(row.status).toBe('SENT');
    expect(row.sent_at).not.toBeNull();
  });

  it('a failed send becomes FAILED with attempts+1 and a backoff, then succeeds on retry', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');
    const id = await seedOutboxRow(requestId);
    const messaging = new FakeMessagingPort();
    messaging.failNextSends = 1;
    const now = new Date();

    const first = await dispatchOutbox(pool, messaging, render, { now });
    expect(first).toEqual({ sent: 0, failed: 1, dead: 0 });

    const afterFail = await outboxRow(id);
    expect(afterFail.status).toBe('FAILED');
    expect(afterFail.attempts).toBe(1);
    expect(afterFail.next_attempt_at.getTime()).toBe(now.getTime() + 30_000);

    // Not due yet -> untouched.
    const early = await dispatchOutbox(pool, messaging, render, { now });
    expect(early).toEqual({ sent: 0, failed: 0, dead: 0 });

    // Due after the backoff -> sent.
    const retry = await dispatchOutbox(pool, messaging, render, { now: new Date(now.getTime() + 31_000) });
    expect(retry).toEqual({ sent: 1, failed: 0, dead: 0 });
    expect((await outboxRow(id)).status).toBe('SENT');
  });

  it('exhausted attempts mark the row DEAD and it is never retried', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');
    const id = await seedOutboxRow(requestId, { status: 'FAILED', attempts: 7 });
    const messaging = new FakeMessagingPort();
    messaging.failNextSends = 1;

    const result = await dispatchOutbox(pool, messaging, render);
    expect(result).toEqual({ sent: 0, failed: 0, dead: 1 });
    expect((await outboxRow(id)).status).toBe('DEAD');

    const again = await dispatchOutbox(pool, messaging, render);
    expect(again).toEqual({ sent: 0, failed: 0, dead: 0 });
    expect(messaging.sent).toEqual([]);
  });

  it('ignores rows that are already SENT or scheduled in the future', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');
    await seedOutboxRow(requestId, { status: 'SENT' });
    await seedOutboxRow(requestId, { nextAttemptAt: new Date(Date.now() + 3600_000) });
    const messaging = new FakeMessagingPort();

    const result = await dispatchOutbox(pool, messaging, render);
    expect(result).toEqual({ sent: 0, failed: 0, dead: 0 });
    expect(messaging.sent).toEqual([]);
  });

  it('a renderer crash counts as a failure, not a dispatcher crash', async () => {
    const { requestId } = await seedRequest(pool, 'HELD');
    const id = await seedOutboxRow(requestId, { templateKey: 'NO_SUCH_TEMPLATE' });
    const messaging = new FakeMessagingPort();
    const strictRender: TemplateRenderer = (key) => {
      throw new Error(`unknown template: ${key}`);
    };

    const result = await dispatchOutbox(pool, messaging, strictRender);
    expect(result).toEqual({ sent: 0, failed: 1, dead: 0 });
    expect((await outboxRow(id)).status).toBe('FAILED');
    expect(messaging.sent).toEqual([]);
  });
});
