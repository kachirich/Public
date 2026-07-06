import type { CapacityWindow } from '@marketplace/core';
import type pg from 'pg';

// Capacity accounting for SERVICE providers. Their bookings never touch
// Cal.com — availability windows and occupancy live entirely in Postgres.
//
// A request consumes window capacity once money is in motion. REQUESTED
// quotes are free to abandon; COUNTER_OFFERED never occurs for SERVICE
// (counter-offers are disabled for them).
export const CAPACITY_CONSUMING_STATES = ['PENDING_PAYMENT', 'HELD', 'ACCEPTED', 'IN_SESSION'];

export async function getServiceWindows(pool: pg.Pool, professionalId: string): Promise<CapacityWindow[]> {
  const { rows } = await pool.query(
    `SELECT weekday, start_minute AS "startMinute", end_minute AS "endMinute", capacity
     FROM professional_availability WHERE professional_id = $1`,
    [professionalId],
  );
  return rows;
}

// Bookings whose [start, end) interval overlaps the given one. Half-open
// ranges, so back-to-back bookings do not count as overlapping.
export async function countOverlapping(
  pool: pg.Pool,
  professionalId: string,
  start: Date,
  durationMinutes: number,
  excludeRequestId?: string,
): Promise<number> {
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM requests
     WHERE professional_id = $1
       AND state = ANY($2)
       AND tstzrange(session_start, session_start + make_interval(mins => duration_minutes))
           && tstzrange($3::timestamptz, $4::timestamptz)
       AND ($5::uuid IS NULL OR id <> $5::uuid)`,
    [professionalId, CAPACITY_CONSUMING_STATES, start, end, excludeRequestId ?? null],
  );
  return rows[0].n;
}

// Serializes count-then-admit critical sections per provider. The requests
// optimistic lock (version) cannot stop a concurrent admission from
// overshooting capacity, and transition() owns its own transaction, so an
// advisory lock is the coordination point instead.
export async function withProviderLock<T>(
  pool: pg.Pool,
  professionalId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(hashtextextended($1::text, 42))`, [professionalId]);
    try {
      return await fn();
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtextextended($1::text, 42))`, [professionalId]);
    }
  } finally {
    client.release();
  }
}
