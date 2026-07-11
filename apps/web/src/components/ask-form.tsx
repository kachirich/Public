'use client';

import { useActionState } from 'react';
import { askAction, type ActionState } from '@/lib/actions';

const initial: ActionState = { error: null };

export function AskForm({
  professionalId,
  feeLine,
  source,
}: {
  professionalId: string;
  feeLine: string;
  source?: string;
}) {
  const [state, formAction, pending] = useActionState(askAction, initial);
  return (
    <form action={formAction}>
      <input type="hidden" name="professionalId" value={professionalId} />
      {source && <input type="hidden" name="source" value={source} />}

      <label htmlFor="ask-displayName">Your name</label>
      <input id="ask-displayName" name="displayName" required autoComplete="name" />

      <label htmlFor="ask-email">Email</label>
      <input id="ask-email" name="email" type="email" required autoComplete="email" />

      <label htmlFor="ask-phone">M-Pesa number</label>
      <input id="ask-phone" name="phone" type="tel" placeholder="+2547..." autoComplete="tel" />

      <label htmlFor="ask-body">Your message (max 500 characters)</label>
      <textarea id="ask-body" name="body" rows={3} maxLength={500} required />

      <button type="submit" disabled={pending}>
        {pending ? 'Sending…' : `Send message · ${feeLine}`}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
