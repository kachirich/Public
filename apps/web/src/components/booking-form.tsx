'use client';

import { useActionState } from 'react';
import { bookAction, type ActionState } from '@/lib/actions';

const initial: ActionState = { error: null };

export function BookingForm({ professionalId }: { professionalId: string }) {
  const [state, formAction, pending] = useActionState(bookAction, initial);

  return (
    <form action={formAction}>
      <input type="hidden" name="professionalId" value={professionalId} />

      <label htmlFor="displayName">Your name</label>
      <input id="displayName" name="displayName" required autoComplete="name" />

      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" required autoComplete="email" />

      <label htmlFor="phone">WhatsApp number (optional)</label>
      <input id="phone" name="phone" type="tel" placeholder="+2547..." autoComplete="tel" />

      <label htmlFor="sessionStart">When</label>
      <input id="sessionStart" name="sessionStart" type="datetime-local" required />

      <label htmlFor="durationMinutes">Duration</label>
      <select id="durationMinutes" name="durationMinutes" defaultValue="60">
        <option value="30">30 minutes</option>
        <option value="60">60 minutes</option>
        <option value="90">90 minutes</option>
      </select>

      <label htmlFor="brief">What do you need help with?</label>
      <textarea id="brief" name="brief" rows={3} required />

      <button type="submit" disabled={pending}>
        {pending ? 'Getting your quote…' : 'Get quote'}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
