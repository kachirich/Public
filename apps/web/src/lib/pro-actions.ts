'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiError, proLoginStart, proLoginVerify, putProAvailability, putProPrivacy, putProSettings, putProStatus, type AvailabilitySlot } from './api';
import type { ActionState } from './actions';

const PRO_COOKIE = 'pro_id';

// v1 portal auth: proving control of the WhatsApp number of a VERIFIED
// professional signs you in (production hardens this with the existing
// WhatsApp OTP flow). The cookie is httpOnly and holds only the id.
export interface LoginState {
  error: string | null;
  challengeId?: string;
  devCode?: string;
}

// Step 1: send the OTP to the professional's WhatsApp.
export async function proLoginStartAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const whatsapp = String(formData.get('whatsapp') ?? '').trim();
  if (!whatsapp) return { error: 'Enter the WhatsApp number you registered with.' };
  try {
    const { challengeId, devCode } = await proLoginStart(whatsapp);
    return { error: null, challengeId, ...(devCode ? { devCode } : {}) };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Sign-in failed. Try again.' };
  }
}

// Step 2: verify the code, then issue the session cookie.
export async function proLoginVerifyAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const challengeId = String(formData.get('challengeId') ?? '');
  const code = String(formData.get('code') ?? '').trim();
  if (!challengeId || !code) return { error: 'Enter the code from WhatsApp.', challengeId };
  let professionalId: string;
  try {
    ({ professional: { id: professionalId } } = await proLoginVerify(challengeId, code));
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Verification failed. Try again.', challengeId };
  }
  const jar = await cookies();
  jar.set(PRO_COOKIE, professionalId, { httpOnly: true, sameSite: 'lax', path: '/' });
  redirect('/pro/dashboard');
}

export async function proLogoutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(PRO_COOKIE);
  redirect('/pro');
}

export async function currentProfessionalId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(PRO_COOKIE)?.value ?? null;
}

export async function togglePrivacyAction(formData: FormData): Promise<void> {
  const professionalId = await currentProfessionalId();
  if (!professionalId) redirect('/pro');
  await putProPrivacy(professionalId, formData.get('showLocation') === 'true');
  redirect('/pro/dashboard');
}

export async function toggleStatusAction(formData: FormData): Promise<void> {
  const professionalId = await currentProfessionalId();
  if (!professionalId) redirect('/pro');
  await putProStatus(professionalId, formData.get('available') === 'true');
  redirect('/pro/dashboard');
}

export async function saveSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const professionalId = await currentProfessionalId();
  if (!professionalId) redirect('/pro');
  const fee = String(formData.get('directMessageFee') ?? '').trim();
  const dmNote = String(formData.get('dmNote') ?? '').trim();
  if (!fee || Number.isNaN(Number(fee)) || Number(fee) < 0) {
    return { error: 'The message fee must be a number (0 turns the fee off).' };
  }
  try {
    await putProSettings(professionalId, { directMessageFee: fee, ...(dmNote ? { dmNote } : {}) });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Saving failed. Try again.' };
  }
  return { error: null, saved: true };
}

export async function saveAvailabilityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const professionalId = await currentProfessionalId();
  if (!professionalId) redirect('/pro');

  if (formData.get('consent') !== 'on') {
    return { error: 'You must consent to sharing your availability before saving.' };
  }

  const slots: AvailabilitySlot[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    if (formData.get(`day-${weekday}-enabled`) !== 'on') continue;
    const start = String(formData.get(`day-${weekday}-start`) ?? '');
    const end = String(formData.get(`day-${weekday}-end`) ?? '');
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if ([sh, sm, eh, em].some((n) => !Number.isInteger(n))) {
      return { error: 'Each enabled day needs a start and end time.' };
    }
    slots.push({ weekday, startMinute: sh! * 60 + sm!, endMinute: eh! * 60 + em! });
  }

  try {
    await putProAvailability(professionalId, true, slots);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Saving failed. Try again.' };
  }
  return { error: null, saved: true };
}
