'use client';

import { useActionState, useState } from 'react';
import type { AvailabilitySlot } from '@/lib/api';
import type { ActionState } from '@/lib/actions';
import { saveServiceAvailabilityAction } from '@/lib/pro-actions';

const initial: ActionState = { error: null };

// Monday-first display order; weekday numbers stay 0 = Sunday to match the DB.
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

interface WindowRow {
  weekday: number;
  start: string;
  end: string;
  capacity: number;
}

function toTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

// Fluid multi-capacity windows: a service business can open several windows
// per day, each taking a set number of clients at the same time.
export function ServiceAvailabilityEditor({
  initialSlots,
  consentedAt,
}: {
  initialSlots: AvailabilitySlot[];
  consentedAt: string | null;
}) {
  const [state, formAction, pending] = useActionState(saveServiceAvailabilityAction, initial);
  const [windows, setWindows] = useState<WindowRow[]>(
    initialSlots.map((s) => ({
      weekday: s.weekday,
      start: toTime(s.startMinute),
      end: toTime(s.endMinute),
      capacity: s.capacity ?? 1,
    })),
  );

  const update = (index: number, patch: Partial<WindowRow>) =>
    setWindows((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));

  return (
    <form action={formAction}>
      <input type="hidden" name="windows" value={JSON.stringify(windows)} />
      <div className="availability-grid">
        {DAY_ORDER.map((weekday) => {
          const dayRows = windows
            .map((w, index) => ({ ...w, index }))
            .filter((w) => w.weekday === weekday);
          return (
            <div key={weekday} className="availability-row" style={{ alignItems: 'flex-start' }}>
              <span className="availability-day">{DAY_LABELS[weekday]}</span>
              <div style={{ flex: 1 }}>
                {dayRows.length === 0 && <span className="pro-affiliation">Closed</span>}
                {dayRows.map((w) => (
                  <div key={w.index} className="availability-row">
                    <input
                      type="time"
                      value={w.start}
                      onChange={(e) => update(w.index, { start: e.target.value })}
                      aria-label={`${DAY_LABELS[weekday]} window start`}
                    />
                    <span className="availability-sep">to</span>
                    <input
                      type="time"
                      value={w.end}
                      onChange={(e) => update(w.index, { end: e.target.value })}
                      aria-label={`${DAY_LABELS[weekday]} window end`}
                    />
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={w.capacity}
                      onChange={(e) => update(w.index, { capacity: Number(e.target.value) })}
                      aria-label={`${DAY_LABELS[weekday]} window capacity`}
                      style={{ width: '5rem' }}
                    />
                    <span className="availability-sep">clients</span>
                    <button
                      type="button"
                      className="button-secondary-solid"
                      onClick={() => setWindows((prev) => prev.filter((_, i) => i !== w.index))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="button-secondary-solid"
                  onClick={() =>
                    setWindows((prev) => [...prev, { weekday, start: '09:00', end: '17:00', capacity: 1 }])
                  }
                >
                  + Add window
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <label className="consent-row">
        <input type="checkbox" name="consent" defaultChecked={!!consentedAt} required />
        <span>
          I consent to Professional Access using these open hours to accept bookings for my
          business. I can change or withdraw them here at any time.
          {consentedAt && <em className="pro-affiliation"> (first consented {new Date(consentedAt).toLocaleDateString()})</em>}
        </span>
      </label>

      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save open hours'}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.saved && !state.error && <p className="verified">Saved. Clients can now book inside these windows.</p>}
    </form>
  );
}
