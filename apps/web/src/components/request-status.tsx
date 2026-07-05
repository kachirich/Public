'use client';

import { useActionState } from 'react';
import useSWR from 'swr';
import type { RequestView } from '@/lib/api';
import { chooseSlotAction, payAction, type ActionState } from '@/lib/actions';
import { STATE_COPY, TERMINAL_STATES, formatMoney, formatWhen, googleCalendarUrl } from '@/lib/display';

const initial: ActionState = { error: null };

const fetcher = async (url: string): Promise<RequestView> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('failed to load request');
  return res.json();
};

export function RequestStatus({ requestId, initialData }: { requestId: string; initialData: RequestView }) {
  const terminal = TERMINAL_STATES.has(initialData.state);
  const { data, mutate } = useSWR(`/api/requests/${requestId}`, fetcher, {
    fallbackData: initialData,
    // Stop polling once the request settles; nothing changes after that.
    refreshInterval: (latest) => (latest && TERMINAL_STATES.has(latest.state) ? 0 : 3000),
    revalidateOnFocus: !terminal,
  });
  const req = data ?? initialData;
  const copy = STATE_COPY[req.state] ?? { title: req.state, detail: '' };

  return (
    <>
      <h1>
        Request #{req.ref_code}{' '}
        <span className="state-badge" data-terminal={TERMINAL_STATES.has(req.state)}>
          {req.state.replace(/_/g, ' ')}
        </span>
      </h1>

      <div className="card">
        <h2>{copy.title}</h2>
        <p>{copy.detail}</p>
        <dl className="breakdown">
          <dt>Professional</dt>
          <dd>
            {req.professional_name}
            {req.professional_affiliation ? ` — ${req.professional_affiliation}` : ''}
          </dd>
          <dt>When</dt>
          <dd>{formatWhen(req.session_start)} · {req.duration_minutes} min</dd>
          <dt>Price</dt>
          <dd>{formatMoney(req.price_gross, req.currency)}</dd>
        </dl>
      </div>

      {req.state === 'REQUESTED' && <PayCard requestId={req.id} />}
      {(req.state === 'ACCEPTED' || req.state === 'IN_SESSION') && <CalendarCard req={req} />}
      {req.state === 'COUNTER_OFFERED' && req.counterOffer && (
        <SlotChooser counterOffer={req.counterOffer} currency={req.currency} onChosen={() => mutate()} />
      )}

      {req.transitions.length > 0 && (
        <div className="card">
          <h2>History</h2>
          <ol className="timeline">
            {req.transitions.map((t, i) => (
              <li key={i}>
                {formatWhen(t.created_at)} — {t.to_state.replace(/_/g, ' ')}
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}

function CalendarCard({ req }: { req: RequestView }) {
  const gcal = googleCalendarUrl({
    refCode: req.ref_code,
    professionalName: req.professional_name,
    sessionStart: req.session_start,
    durationMinutes: req.duration_minutes,
  });
  return (
    <div className="card">
      <h2>Save it to your calendar</h2>
      <p>Don&apos;t miss your session — add it to the calendar you actually check.</p>
      <div className="calendar-links">
        <a className="button-link" href={gcal} target="_blank" rel="noopener noreferrer">
          Add to Google Calendar
        </a>
        <a className="button-link button-secondary" href={`/api/requests/${req.id}/ics`}>
          Download .ics (Apple / Outlook)
        </a>
      </div>
    </div>
  );
}

function PayCard({ requestId }: { requestId: string }) {
  const [state, formAction, pending] = useActionState(payAction, initial);
  return (
    <div className="card">
      <h2>Complete your booking</h2>
      <p>Your payment is held in escrow and only released after the session completes.</p>
      <form action={formAction}>
        <input type="hidden" name="requestId" value={requestId} />
        <button type="submit" disabled={pending}>
          {pending ? 'Starting payment…' : 'Pay now'}
        </button>
        {state.error && <p role="alert">{state.error}</p>}
      </form>
    </div>
  );
}

function SlotChooser({
  counterOffer,
  currency,
  onChosen,
}: {
  counterOffer: NonNullable<RequestView['counterOffer']>;
  currency: string;
  onChosen: () => void;
}) {
  const [state, formAction, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await chooseSlotAction(prev, formData);
    if (!result.error) onChosen();
    return result;
  }, initial);

  return (
    <div className="card">
      <h2>The professional proposed new times</h2>
      <p>Pick one to confirm your session. If the new time is cheaper, we refund the difference.</p>
      <form action={formAction}>
        <input type="hidden" name="counterOfferId" value={counterOffer.id} />
        {counterOffer.slots.map((slot, i) => (
          <label key={slot.id} className="slot-option">
            <input type="radio" name="slotId" value={slot.id} required defaultChecked={i === 0} style={{ width: 'auto' }} />
            {formatWhen(slot.slotStart)} · {slot.durationMinutes} min · {formatMoney(slot.priceGross, currency)}
          </label>
        ))}
        <button type="submit" disabled={pending}>
          {pending ? 'Confirming…' : 'Confirm this time'}
        </button>
        {state.error && <p role="alert">{state.error}</p>}
      </form>
    </div>
  );
}
