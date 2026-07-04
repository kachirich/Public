import type { Pool } from 'pg';
import type { RequestState } from '../state/transitions.js';

export interface TimerJobContext {
  pool: Pool;
  jobId: string;
  requestId: string;
  /** Request state as read when the job was claimed. Handlers must treat a
   *  stale state as normal: transition() re-checks under lock anyway. */
  requestState: RequestState;
}

export type TimerOutcome = 'DONE' | 'SKIPPED';
export type TimerHandler = (ctx: TimerJobContext) => Promise<TimerOutcome>;

export interface PollOptions {
  batchSize?: number;
  now?: Date;
}

export interface PollResult {
  done: number;
  skipped: number;
}

// One poller tick: claim due SCHEDULED jobs whose type we have a handler for
// (SKIP LOCKED for concurrent pollers), run each handler, record the outcome.
// Timers check state, never assume it — the handler decides SKIPPED, and any
// state change it makes goes through transition(), which re-checks under lock.
export async function pollTimers(
  pool: Pool,
  handlers: Record<string, TimerHandler>,
  options: PollOptions = {},
): Promise<PollResult> {
  const batchSize = options.batchSize ?? 50;
  const now = options.now ?? new Date();
  const jobTypes = Object.keys(handlers);
  const result: PollResult = { done: 0, skipped: 0 };
  if (jobTypes.length === 0) return result;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT j.id, j.job_type, j.request_id, r.state AS request_state
       FROM scheduled_jobs j
       JOIN requests r ON r.id = j.request_id
       WHERE j.status = 'SCHEDULED' AND j.run_at <= $1 AND j.job_type = ANY($2)
       ORDER BY j.run_at
       LIMIT $3
       FOR UPDATE OF j SKIP LOCKED`,
      [now, jobTypes, batchSize],
    );

    for (const row of rows) {
      const handler = handlers[row.job_type];
      if (!handler) continue; // unreachable given the ANY filter; satisfies noUncheckedIndexedAccess
      const outcome = await handler({
        pool,
        jobId: row.id,
        requestId: row.request_id,
        requestState: row.request_state,
      });
      await client.query(`UPDATE scheduled_jobs SET status = $2, fired_at = now() WHERE id = $1`, [row.id, outcome]);
      if (outcome === 'DONE') result.done += 1;
      else result.skipped += 1;
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
