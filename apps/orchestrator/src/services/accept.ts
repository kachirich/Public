import { findCoveringWindow, IllegalTransitionError, transition, type ActorType } from '@marketplace/core';
import type { AppDeps } from '../deps.js';
import { computeBreakdown, toCents } from './pricing.js';
import { QuoteError } from './quotes.js';
import { countOverlapping, getServiceWindows, withProviderLock } from './service-availability.js';

// Accept a HELD request: create the Cal.com booking first (force-book for
// off-availability tiers), then transition. If the transition loses a race
// (e.g. expiry fired first), compensate by cancelling the booking.
//
// SERVICE providers have no Cal.com booking; their mutual exclusion is the
// window-capacity re-check, done atomically under the provider lock.
export async function acceptRequest(deps: AppDeps, requestId: string, actor: ActorType): Promise<void> {
  const { rows } = await deps.pool.query(
    `SELECT r.state, r.tier, r.session_start, r.duration_minutes, r.ref_code, r.professional_id,
            p.provider_type, p.calcom_user_id, p.calcom_event_type
     FROM requests r JOIN professionals p ON p.id = r.professional_id WHERE r.id = $1`,
    [requestId],
  );
  const row = rows[0];
  if (!row) throw new QuoteError(404, 'request not found');

  if (row.provider_type === 'SERVICE') {
    await withProviderLock(deps.pool, row.professional_id, async () => {
      const windows = await getServiceWindows(deps.pool, row.professional_id);
      const window = findCoveringWindow(windows, row.session_start, row.duration_minutes);
      if (!window) throw new QuoteError(409, 'this time is no longer within the open hours');
      // Exclude this request: it is HELD, which already counts.
      const taken = await countOverlapping(
        deps.pool, row.professional_id, row.session_start, row.duration_minutes, requestId,
      );
      if (taken >= window.capacity) throw new QuoteError(409, 'capacity is already full at that time');
      await transition(deps.pool, requestId, 'ACCEPTED', actor, 'ACCEPT', {}, { now: deps.now() });
    });
    return;
  }

  const { bookingId } = await deps.scheduling.createBooking({
    calcomUserId: row.calcom_user_id,
    calcomEventType: row.calcom_event_type,
    start: row.session_start,
    durationMinutes: row.duration_minutes,
    force: row.tier !== 'IN_HOURS',
    metadata: { requestRef: row.ref_code },
  });

  try {
    await transition(deps.pool, requestId, 'ACCEPTED', actor, 'ACCEPT', {}, { now: deps.now() });
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      await deps.scheduling.cancelBooking(bookingId, `request ${row.ref_code} already ${err.currentState}`);
    }
    throw err;
  }
  await deps.pool.query(`UPDATE requests SET calcom_booking_id = $2 WHERE id = $1`, [requestId, bookingId]);
}

// Client picks a counter-offer slot. Slot availability is re-validated at
// acceptance (createBooking throws if taken); a cheaper slot yields a
// partial refund of the difference, executed against the original HOLD.
export async function chooseCounterSlot(deps: AppDeps, counterOfferId: string, slotId: string): Promise<void> {
  const { rows } = await deps.pool.query(
    `SELECT co.request_id, co.resolved_at, co.expires_at,
            s.id AS slot_id, s.slot_start, s.duration_minutes AS slot_duration, s.tier AS slot_tier,
            s.price_gross AS slot_gross,
            r.state, r.price_gross AS original_gross, r.ref_code,
            p.calcom_user_id, p.calcom_event_type, p.fee_percent
     FROM counter_offers co
     JOIN counter_offer_slots s ON s.counter_offer_id = co.id AND s.id = $2
     JOIN requests r ON r.id = co.request_id
     JOIN professionals p ON p.id = r.professional_id
     WHERE co.id = $1`,
    [counterOfferId, slotId],
  );
  const row = rows[0];
  if (!row) throw new QuoteError(404, 'counter offer or slot not found');
  if (row.resolved_at) throw new QuoteError(409, 'counter offer already resolved');
  if (row.state !== 'COUNTER_OFFERED') throw new QuoteError(409, `request is ${row.state}`);
  const now = deps.now();
  if (row.expires_at.getTime() <= now.getTime()) throw new QuoteError(409, 'counter offer has expired');

  const { bookingId } = await deps.scheduling.createBooking({
    calcomUserId: row.calcom_user_id,
    calcomEventType: row.calcom_event_type,
    start: row.slot_start,
    durationMinutes: row.slot_duration,
    force: row.slot_tier !== 'IN_HOURS',
    metadata: { requestRef: row.ref_code, counterSlot: 'true' },
  });

  // Always charge the lower of the two tier prices (slot rows already store
  // min(original, slot tier price)); refund any difference.
  const diffCents = toCents(row.original_gross) - toCents(row.slot_gross);
  let partialRefund: { partialRefundAmount: string; providerRef: string } | undefined;
  if (diffCents > 0) {
    const amount = `${Math.floor(diffCents / 100)}.${String(diffCents % 100).padStart(2, '0')}`;
    const holdRef = await holdProviderRef(deps, row.request_id);
    const { refundRef } = await deps.payments.refund(holdRef, amount);
    partialRefund = { partialRefundAmount: amount, providerRef: refundRef };
  }

  const breakdown = computeBreakdown(row.slot_gross, row.fee_percent);
  await deps.pool.query(
    `UPDATE requests SET session_start = $2, duration_minutes = $3, tier = $4,
            price_gross = $5, platform_fee = $6, payout_net = $7 WHERE id = $1`,
    [row.request_id, row.slot_start, row.slot_duration, row.slot_tier, breakdown.gross, breakdown.fee, breakdown.net],
  );

  try {
    await transition(
      deps.pool,
      row.request_id,
      'ACCEPTED',
      'CLIENT',
      'COUNTER_SLOT_CHOSEN',
      partialRefund ?? {},
      { now },
    );
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      await deps.scheduling.cancelBooking(bookingId, `request ${row.ref_code} already ${err.currentState}`);
    }
    throw err;
  }

  await deps.pool.query(`UPDATE requests SET calcom_booking_id = $2 WHERE id = $1`, [row.request_id, bookingId]);
  await deps.pool.query(`UPDATE counter_offers SET resolved_at = $2 WHERE id = $1`, [counterOfferId, now]);
  await deps.pool.query(`UPDATE counter_offer_slots SET is_chosen = true WHERE id = $1`, [slotId]);
}

export async function holdProviderRef(deps: AppDeps, requestId: string): Promise<string> {
  const { rows } = await deps.pool.query(
    `SELECT provider_ref FROM ledger_entries WHERE request_id = $1 AND entry_type = 'HOLD' ORDER BY id LIMIT 1`,
    [requestId],
  );
  const ref = rows[0]?.provider_ref;
  if (!ref) throw new Error(`No HOLD ledger entry with provider_ref for request ${requestId}`);
  return ref;
}
