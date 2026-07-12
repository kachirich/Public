'use client';

import { useActionState } from 'react';
import { claimProfileAction, type ClaimState } from '@/lib/pro-actions';

const initial: ClaimState = { error: null };

export function ClaimForm() {
  const [state, action, pending] = useActionState(claimProfileAction, initial);

  return (
    <form action={action}>
      <button type="submit" disabled={pending}>
        {pending ? 'Claiming…' : "Yes, this is me — claim this listing"}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
