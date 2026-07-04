import { IllegalTransitionError } from '../state/errors.js';
import { transition } from '../state/transition.js';
import type { TimerHandler, TimerOutcome } from './poller.js';

// A transition losing the race to a fresher state change is the normal,
// expected case for a timer — that's a SKIP, not an error.
async function skippedOnIllegal(fn: () => Promise<unknown>): Promise<TimerOutcome> {
  try {
    await fn();
    return 'DONE';
  } catch (err) {
    if (err instanceof IllegalTransitionError) return 'SKIPPED';
    throw err;
  }
}

// Card timed out while still waiting on the professional -> EXPIRED.
export const cardExpiryHandler: TimerHandler = async ({ pool, requestId, requestState }) => {
  if (requestState !== 'HELD') return 'SKIPPED';
  return skippedOnIllegal(() => transition(pool, requestId, 'EXPIRED', 'TIMER', 'CARD_EXPIRY'));
};

// Counter-offer timed out while still waiting on the client -> EXPIRED.
export const counterExpiryHandler: TimerHandler = async ({ pool, requestId, requestState }) => {
  if (requestState !== 'COUNTER_OFFERED') return 'SKIPPED';
  return skippedOnIllegal(() => transition(pool, requestId, 'EXPIRED', 'TIMER', 'COUNTER_EXPIRY'));
};

// Halfway-to-expiry nudge. No state change — just an outbox row, idempotent
// on the job id so a crashed-then-retried tick can't queue it twice.
export const cardReminderHandler: TimerHandler = async ({ pool, jobId, requestId, requestState }) => {
  if (requestState !== 'HELD') return 'SKIPPED';

  const { rows } = await pool.query(
    `SELECT r.ref_code, r.card_expires_at, r.session_start, r.payout_net, r.currency,
            p.whatsapp_e164, p.preferred_channel
     FROM requests r JOIN professionals p ON p.id = r.professional_id
     WHERE r.id = $1`,
    [requestId],
  );
  const row = rows[0];
  if (!row) return 'SKIPPED';

  await pool.query(
    `INSERT INTO outbox_messages (request_id, channel, recipient, template_key, payload, idempotency_key)
     VALUES ($1, $2, $3, 'CARD_REMINDER', $4, $5)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      requestId,
      row.preferred_channel,
      row.whatsapp_e164,
      JSON.stringify({
        refCode: row.ref_code,
        expiresAt: row.card_expires_at?.toISOString(),
        sessionStart: row.session_start.toISOString(),
        payoutNet: row.payout_net,
        currency: row.currency,
      }),
      `${requestId}:CARD_REMINDER:job:${jobId}`,
    ],
  );
  return 'DONE';
};

// Handlers available in phase 3. Room/session handlers (ROOM_OPEN,
// NO_SHOW_CHECK, SESSION_END*, ROOM_DISSOLVE) arrive with consult rooms in
// later phases; until registered, the poller leaves their jobs untouched.
export const PHASE3_HANDLERS = {
  CARD_EXPIRY: cardExpiryHandler,
  CARD_REMINDER: cardReminderHandler,
  COUNTER_EXPIRY: counterExpiryHandler,
};
