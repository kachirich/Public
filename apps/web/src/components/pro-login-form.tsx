'use client';

import { useActionState } from 'react';
import { proLoginStartAction, proLoginVerifyAction, type LoginState } from '@/lib/pro-actions';

const initial: LoginState = { error: null };

export function ProLoginForm() {
  const [startState, startAction, startPending] = useActionState(proLoginStartAction, initial);
  const [verifyState, verifyAction, verifyPending] = useActionState(proLoginVerifyAction, initial);

  const challengeId = verifyState.challengeId ?? startState.challengeId;

  if (!challengeId) {
    return (
      <form action={startAction}>
        <label htmlFor="whatsapp">Registered WhatsApp number</label>
        <input id="whatsapp" name="whatsapp" type="tel" placeholder="+2547..." required autoComplete="tel" />
        <button type="submit" disabled={startPending}>
          {startPending ? 'Sending code…' : 'Send code to WhatsApp'}
        </button>
        {startState.error && <p role="alert">{startState.error}</p>}
      </form>
    );
  }

  return (
    <form action={verifyAction}>
      <input type="hidden" name="challengeId" value={challengeId} />
      <p className="pro-affiliation">We sent a 6-digit code to your WhatsApp. It expires in 10 minutes.</p>
      {startState.devCode && (
        <p className="dev-hint">
          Dev mode — your code is <strong>{startState.devCode}</strong>
        </p>
      )}
      <label htmlFor="code">Verification code</label>
      <input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus />
      <button type="submit" disabled={verifyPending}>
        {verifyPending ? 'Verifying…' : 'Verify & sign in'}
      </button>
      {verifyState.error && <p role="alert">{verifyState.error}</p>}
    </form>
  );
}
