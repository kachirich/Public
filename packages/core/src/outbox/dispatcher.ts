import type { Pool } from 'pg';
import type { MessagingPort } from '../ports/messaging.js';

// Renders a template into a message body. The real template functions arrive
// in phase 4; until then callers inject whatever renderer they want.
export type TemplateRenderer = (templateKey: string, payload: Record<string, unknown>) => string;

export interface DispatchOptions {
  batchSize?: number;
  maxAttempts?: number;
  now?: Date;
}

export interface DispatchResult {
  sent: number;
  failed: number;
  dead: number;
}

const DEFAULT_BATCH = 50;
const DEFAULT_MAX_ATTEMPTS = 8;

function backoffMs(attempts: number): number {
  // 30s, 60s, 2m, 4m ... capped at 1h.
  return Math.min(30_000 * 2 ** (attempts - 1), 3_600_000);
}

// One dispatcher tick: claim due PENDING/FAILED outbox rows (SKIP LOCKED so
// concurrent dispatchers never double-send), send each through the port,
// mark SENT / FAILED-with-backoff / DEAD.
export async function dispatchOutbox(
  pool: Pool,
  messaging: MessagingPort,
  render: TemplateRenderer,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const now = options.now ?? new Date();
  const result: DispatchResult = { sent: 0, failed: 0, dead: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, channel, recipient, template_key, payload, attempts
       FROM outbox_messages
       WHERE status IN ('PENDING', 'FAILED') AND next_attempt_at <= $1
       ORDER BY next_attempt_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [now, batchSize],
    );

    for (const row of rows) {
      try {
        const body = render(row.template_key, row.payload);
        await messaging.send({ channel: row.channel, recipient: row.recipient, body });
        await client.query(`UPDATE outbox_messages SET status = 'SENT', sent_at = now() WHERE id = $1`, [row.id]);
        result.sent += 1;
      } catch {
        const attempts = row.attempts + 1;
        if (attempts >= maxAttempts) {
          await client.query(
            `UPDATE outbox_messages SET status = 'DEAD', attempts = $2 WHERE id = $1`,
            [row.id, attempts],
          );
          result.dead += 1;
        } else {
          await client.query(
            `UPDATE outbox_messages SET status = 'FAILED', attempts = $2, next_attempt_at = $3 WHERE id = $1`,
            [row.id, attempts, new Date(now.getTime() + backoffMs(attempts))],
          );
          result.failed += 1;
        }
      }
    }

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
