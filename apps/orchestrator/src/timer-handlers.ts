import { PHASE3_HANDLERS, transition, type TimerHandler } from '@marketplace/core';
import type { AppDeps } from './deps.js';
import { holdProviderRef } from './services/accept.js';

// Every handler re-reads state and SKIPs when the world moved on; state
// changes go through transition(), which re-checks under lock.
export function buildTimerHandlers(deps: AppDeps): Record<string, TimerHandler> {
  const refundExecute: TimerHandler = async ({ pool, requestId, requestState }) => {
    if (!['DECLINED', 'EXPIRED', 'NO_SHOW_PROFESSIONAL'].includes(requestState)) return 'SKIPPED';
    const { rows } = await pool.query(`SELECT price_gross FROM requests WHERE id = $1`, [requestId]);
    const holdRef = await holdProviderRef(deps, requestId);
    const { refundRef } = await deps.payments.refund(holdRef, rows[0].price_gross);
    await transition(pool, requestId, 'REFUNDED', 'SYSTEM', 'REFUND_CONFIRMED', { providerRef: refundRef }, { now: deps.now() });
    return 'DONE';
  };

  const roomOpen: TimerHandler = async ({ pool, jobId, requestId, requestState }) => {
    if (requestState !== 'ACCEPTED') return 'SKIPPED';
    const { rows } = await pool.query(
      `SELECT r.ref_code, r.session_start, r.duration_minutes,
              p.whatsapp_e164 AS prof_wa, p.display_name AS prof_name,
              c.phone_e164 AS client_phone, c.display_name AS client_name
       FROM requests r
       JOIN professionals p ON p.id = r.professional_id
       JOIN clients c ON c.id = r.client_id
       WHERE r.id = $1`,
      [requestId],
    );
    const row = rows[0];
    const participants = [row.prof_wa, ...(row.client_phone ? [row.client_phone] : [])];
    const { roomId } = await deps.rooms.createRoom(`Session #${row.ref_code}`, participants);
    // DB-stamped, not deps.now(): presence checks compare opened_at against
    // inbound_messages.created_at, which the DB also stamps — one clock.
    await pool.query(
      `INSERT INTO consult_rooms (request_id, wa_group_id, opened_at)
       VALUES ($1, $2, now()) ON CONFLICT (request_id) DO NOTHING`,
      [requestId, roomId],
    );
    await transition(pool, requestId, 'IN_SESSION', 'TIMER', 'ROOM_OPEN', {}, { now: deps.now() });
    await pool.query(
      `INSERT INTO outbox_messages (request_id, channel, recipient, template_key, payload, idempotency_key)
       VALUES ($1, 'WHATSAPP', $2, 'ROOM_WELCOME', $3, $4) ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        requestId,
        roomId,
        JSON.stringify({
          refCode: row.ref_code,
          professionalName: row.prof_name,
          clientName: row.client_name,
          sessionStart: row.session_start.toISOString(),
          durationMinutes: row.duration_minutes,
        }),
        `${requestId}:ROOM_WELCOME:job:${jobId}`,
      ],
    );
    return 'DONE';
  };

  // start+5min: nudge an absent professional. start+15min: no-show.
  // Presence = any inbound message from the professional after the room
  // opened (the gateway forwards their messages either way).
  const noShowCheck: TimerHandler = async ({ pool, jobId, requestId, requestState }) => {
    if (requestState !== 'IN_SESSION') return 'SKIPPED';
    const { rows } = await pool.query(
      `SELECT r.ref_code, r.session_start, cr.opened_at, p.id AS prof_id, p.whatsapp_e164,
              EXISTS (
                SELECT 1 FROM inbound_messages im
                WHERE im.professional_id = p.id AND im.created_at >= cr.opened_at
              ) AS professional_present
       FROM requests r
       JOIN professionals p ON p.id = r.professional_id
       JOIN consult_rooms cr ON cr.request_id = r.id
       WHERE r.id = $1`,
      [requestId],
    );
    const row = rows[0];
    if (!row) return 'SKIPPED'; // no room yet — nothing to check
    if (row.professional_present) return 'DONE';

    const now = deps.now();
    const minutesLate = Math.round((now.getTime() - row.session_start.getTime()) / 60_000);
    const isFinalCheck = minutesLate >= 15;
    if (!isFinalCheck) {
      await pool.query(
        `INSERT INTO outbox_messages (request_id, channel, recipient, template_key, payload, idempotency_key)
         VALUES ($1, 'WHATSAPP', $2, 'NO_SHOW_NUDGE', $3, $4) ON CONFLICT (idempotency_key) DO NOTHING`,
        [requestId, row.whatsapp_e164, JSON.stringify({ refCode: row.ref_code, minutesLate }), `${requestId}:NO_SHOW_NUDGE:job:${jobId}`],
      );
      return 'DONE';
    }

    await transition(pool, requestId, 'NO_SHOW_PROFESSIONAL', 'TIMER', 'NO_SHOW_CHECK', {}, { now });
    await pool.query(`UPDATE professionals SET no_show_count = no_show_count + 1 WHERE id = $1`, [row.prof_id]);
    return 'DONE';
  };

  const sessionEndWarning: TimerHandler = async ({ pool, jobId, requestId, requestState }) => {
    if (requestState !== 'IN_SESSION') return 'SKIPPED';
    const { rows } = await pool.query(
      `SELECT r.ref_code, cr.wa_group_id FROM requests r
       JOIN consult_rooms cr ON cr.request_id = r.id WHERE r.id = $1`,
      [requestId],
    );
    if (!rows[0]) return 'SKIPPED';
    await pool.query(
      `INSERT INTO outbox_messages (request_id, channel, recipient, template_key, payload, idempotency_key)
       VALUES ($1, 'WHATSAPP', $2, 'SESSION_END_WARNING', $3, $4) ON CONFLICT (idempotency_key) DO NOTHING`,
      [requestId, rows[0].wa_group_id, JSON.stringify({ refCode: rows[0].ref_code, minutesLeft: 10 }), `${requestId}:SESSION_END_WARNING:job:${jobId}`],
    );
    return 'DONE';
  };

  const sessionEnd: TimerHandler = async ({ pool, requestId, requestState }) => {
    if (requestState !== 'IN_SESSION') return 'SKIPPED';
    await transition(pool, requestId, 'COMPLETED', 'TIMER', 'SESSION_END', {}, { now: deps.now() });
    return 'DONE';
  };

  const roomDissolve: TimerHandler = async ({ pool, requestId }) => {
    const { rows } = await pool.query(
      `SELECT cr.wa_group_id, cr.dissolved_at, p.whatsapp_e164, c.phone_e164
       FROM consult_rooms cr
       JOIN requests r ON r.id = cr.request_id
       JOIN professionals p ON p.id = r.professional_id
       JOIN clients c ON c.id = r.client_id
       WHERE cr.request_id = $1`,
      [requestId],
    );
    const row = rows[0];
    if (!row || row.dissolved_at) return 'SKIPPED';
    const participants = [row.whatsapp_e164, ...(row.phone_e164 ? [row.phone_e164] : [])];
    await deps.rooms.dissolveRoom(row.wa_group_id, participants);
    await pool.query(`UPDATE consult_rooms SET dissolved_at = $2 WHERE request_id = $1`, [requestId, deps.now()]);
    return 'DONE';
  };

  return {
    ...PHASE3_HANDLERS,
    REFUND_EXECUTE: refundExecute,
    ROOM_OPEN: roomOpen,
    NO_SHOW_CHECK: noShowCheck,
    SESSION_END_WARNING: sessionEndWarning,
    SESSION_END: sessionEnd,
    ROOM_DISSOLVE: roomDissolve,
  };
}
