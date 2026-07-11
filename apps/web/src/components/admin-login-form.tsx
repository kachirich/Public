'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/lib/actions';
import { adminLoginAction } from '@/lib/admin-actions';

const initial: ActionState = { error: null };

export function AdminLoginForm() {
  const [state, formAction, pending] = useActionState(adminLoginAction, initial);
  return (
    <form action={formAction}>
      <label htmlFor="token">Admin token</label>
      <input id="token" name="token" type="password" required autoComplete="off" />
      <button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
