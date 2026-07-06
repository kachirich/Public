'use client';

import { useActionState } from 'react';
import { proLoginVerifyAction, proRegisterAction, type LoginState } from '@/lib/pro-actions';

const initial: LoginState = { error: null };

// Light registration for service businesses: after the details are in, the
// flow is identical to login — verify the WhatsApp OTP and land on the
// dashboard.
export function ProRegisterForm() {
  const [registerState, registerAction, registerPending] = useActionState(proRegisterAction, initial);
  const [verifyState, verifyAction, verifyPending] = useActionState(proLoginVerifyAction, initial);

  const challengeId = verifyState.challengeId ?? registerState.challengeId;

  if (!challengeId) {
    return (
      <form action={registerAction}>
        <label htmlFor="displayName">Your name</label>
        <input id="displayName" name="displayName" required autoComplete="name" />
        <label htmlFor="businessName">Business name</label>
        <input id="businessName" name="businessName" required placeholder="e.g. Jane's Salon" autoComplete="organization" />
        <label htmlFor="whatsapp">WhatsApp number</label>
        <input id="whatsapp" name="whatsapp" type="tel" placeholder="+2547..." required autoComplete="tel" />
        <label htmlFor="flatPrice">Price per booking (KES, optional)</label>
        <input id="flatPrice" name="flatPrice" inputMode="decimal" placeholder="e.g. 800" />
        <button type="submit" disabled={registerPending}>
          {registerPending ? 'Registering…' : 'Register & get code'}
        </button>
        {registerState.error && <p role="alert">{registerState.error}</p>}
      </form>
    );
  }

  return (
    <form action={verifyAction}>
      <input type="hidden" name="challengeId" value={challengeId} />
      <p className="pro-affiliation">We sent a 6-digit code to your WhatsApp. It expires in 10 minutes.</p>
      {registerState.devCode && (
        <p className="dev-hint">
          Dev mode — your code is <strong>{registerState.devCode}</strong>
        </p>
      )}
      <label htmlFor="code">Verification code</label>
      <input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus />
      <button type="submit" disabled={verifyPending}>
        {verifyPending ? 'Verifying…' : 'Verify & open dashboard'}
      </button>
      {verifyState.error && <p role="alert">{verifyState.error}</p>}
    </form>
  );
}
