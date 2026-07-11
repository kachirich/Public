'use client';

import { useActionState } from 'react';
import type { AvailabilitySlot } from '@/lib/api';
import type { ActionState } from '@/lib/actions';
import { saveAvailabilityAction } from '@/lib/pro-actions';

const initial: ActionState = { error: null };

// Monday-first display order; weekday numbers stay 0 = Sunday to match the DB.
const DAYS: { weekday: number; label: string }[] = [
  { weekday: 1, label: 'Monday' },
  { weekday: 2, label: 'Tuesday' },
  { weekday: 3, label: 'Wednesday' },
  { weekday: 4, label: 'Thursday' },
  { weekday: 5, label: 'Friday' },
  { weekday: 6, label: 'Saturday' },
  { weekday: 0, label: 'Sunday' },
];

function toTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function AvailabilityEditor({
  initialSlots,
  consentedAt,
}: {
  initialSlots: AvailabilitySlot[];
  consentedAt: string | null;
}) {
  const [state, formAction, pending] = useActionState(saveAvailabilityAction, initial);
  const byDay = new Map(initialSlots.map((s) => [s.weekday, s]));

  return (
    <form action={formAction}>
      <div className="availability-grid">
        {DAYS.map(({ weekday, label }) => {
          const slot = byDay.get(weekday);
          return (
            <div key={weekday} className="availability-row">
              <label className="availability-day">
                <input type="checkbox" name={`day-${weekday}-enabled`} defaultChecked={!!slot} />
                {label}
              </label>
              <input type="time" name={`day-${weekday}-start`} defaultValue={slot ? toTime(slot.startMinute) : '09:00'} />
              <span className="availability-sep">to</span>
              <input type="time" name={`day-${weekday}-end`} defaultValue={slot ? toTime(slot.endMinute) : '17:00'} />
            </div>
          );
        })}
      </div>

      <label className="consent-row">
        <input type="checkbox" name="consent" defaultChecked={!!consentedAt} required />
        <span>
          I consent to Professional Access using these hours to price and route booking requests to
          me. I can change or withdraw them here at any time.
          {consentedAt && <em className="pro-affiliation"> (first consented {new Date(consentedAt).toLocaleDateString()})</em>}
        </span>
      </label>

      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save availability'}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.saved && !state.error && <p className="verified">Saved. New quotes now use these hours.</p>}
    </form>
  );
}
