'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ApiError,
  applyAsProfessional,
  claimProfessional,
  getProForPortal,
  proLoginStart,
  proLoginVerify,
  putProAvailability,
  putProPrivacy,
  putProSettings,
  putProStatus,
  type ApplyProfessionalInput,
  type AvailabilitySlot,
  type PortalProfessional,
  type ProfessionalCategory,
} from './api';
import { currentAuthKitUser, logoutAuthKit } from './authkit-server';
import type { AuthKitUser } from './authkit';
import type { ActionState } from './actions';
import { portalDestination } from './portal-destination';

const PRO_COOKIE = 'pro_id';

// v1 portal auth: proving control of the WhatsApp number of a VERIFIED
// professional signs you in. The cookie is httpOnly and holds only the id.
// This is layer two of two: apps/web/src/middleware.ts already requires a
// valid AuthKit session for everything under /pro before any of these
// actions even run — this file only ever needs to worry about the
// WhatsApp/claim layer.
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

// Step 2: verify the code, then issue the session cookie. Where this lands
// next depends on claim state — an unclaimed/hospital-verified profile
// goes to the claim screen instead of straight to the dashboard.
export async function proLoginVerifyAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const challengeId = String(formData.get('challengeId') ?? '');
  const code = String(formData.get('code') ?? '').trim();
  if (!challengeId || !code) return { error: 'Enter the code from WhatsApp.', challengeId };
  let professional: PortalProfessional;
  try {
    ({ professional } = await proLoginVerify(challengeId, code));
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Verification failed. Try again.', challengeId };
  }
  const jar = await cookies();
  jar.set(PRO_COOKIE, professional.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  redirect(portalDestination(professional));
}

export async function proLogoutAction(): Promise<void> {
  await logoutAuthKit();
  const jar = await cookies();
  jar.delete(PRO_COOKIE);
  redirect('/pro');
}

export async function currentProfessionalId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(PRO_COOKIE)?.value ?? null;
}

// Loads the professional for the current pro_id cookie, if any, alongside
// the current AuthKit session — without redirecting. Every check below
// builds on this rather than duplicating the cookie/API/comparison logic.
async function loadPortalProfessional(): Promise<{ professional: PortalProfessional; authkitUser: AuthKitUser } | null> {
  const professionalId = await currentProfessionalId();
  if (!professionalId) return null;
  const authkitUser = await currentAuthKitUser();
  if (!authkitUser) return null; // shouldn't happen — middleware already gates /pro/*
  try {
    const { professional } = await getProForPortal(professionalId);
    return { professional, authkitUser };
  } catch {
    return null;
  }
}

// Non-redirecting: used by the login page to decide whether to skip
// straight past the WhatsApp-OTP form. Returns null on any mismatch
// (including "claimed by a different AuthKit account") rather than
// redirecting — the login page then just falls through to showing the
// form again, which is what breaks what would otherwise be an infinite
// redirect loop with requireOwnedProfessional below (cookies can't be
// mutated during a page render to clear a stale pro_id there instead).
export async function peekOwnedProfessional(): Promise<PortalProfessional | null> {
  const loaded = await loadPortalProfessional();
  if (!loaded) return null;
  const { professional, authkitUser } = loaded;
  if (professional.claimStatus === 'FULLY_ACTIVATED' && professional.authkitUserId !== authkitUser.id) return null;
  return professional;
}

// The claim screen's entry check: WhatsApp OTP must already be done (a
// pro_id cookie must exist), but there's no prior ownership to verify yet
// — claiming *establishes* it. Already-activated profiles skip straight to
// wherever they actually belong instead of re-showing the claim screen.
export async function requireClaimableProfessional(): Promise<PortalProfessional> {
  const loaded = await loadPortalProfessional();
  if (!loaded) redirect('/pro');
  if (loaded.professional.claimStatus === 'FULLY_ACTIVATED') redirect(portalDestination(loaded.professional));
  return loaded.professional;
}

// The pending-verification screen's entry check: the profile must already
// be claimed by the caller, and verification must not have finished yet.
// Reachable today only via self-application (POST /pro/apply), which lands
// a FULLY_ACTIVATED-but-PENDING_VERIFICATION row — WhatsApp-OTP login can
// never produce one, since /pro/login itself only issues challenges for
// already-VERIFIED professionals.
export async function requirePendingProfessional(): Promise<PortalProfessional> {
  const loaded = await loadPortalProfessional();
  if (!loaded) redirect('/pro');
  const { professional, authkitUser } = loaded;
  if (professional.claimStatus !== 'FULLY_ACTIVATED') redirect('/pro/claim');
  if (professional.authkitUserId !== authkitUser.id) redirect('/pro');
  if (professional.verificationStatus === 'VERIFIED') redirect('/pro/dashboard');
  return professional;
}

// The dashboard's entry check, and the authorization check every mutating
// action below runs first. Three things must all hold: the profile must
// actually be claimed, the AuthKit account signed in right now must be the
// one that claimed it — pro_id alone is a raw, forgeable UUID (not a signed
// token), so without this comparison, any AuthKit account paired with a
// guessed/forged pro_id cookie would reach someone else's dashboard and
// controls — and it must be VERIFIED, since every mutating route below is
// backed by findActivated on the orchestrator, which 404s otherwise.
export async function requireOwnedProfessional(): Promise<PortalProfessional> {
  const loaded = await loadPortalProfessional();
  if (!loaded) redirect('/pro');
  const { professional, authkitUser } = loaded;
  if (professional.claimStatus !== 'FULLY_ACTIVATED') redirect('/pro/claim');
  if (professional.authkitUserId !== authkitUser.id) redirect('/pro');
  if (professional.verificationStatus !== 'VERIFIED') redirect('/pro/pending');
  return professional;
}

export interface ClaimState {
  error: string | null;
}

export async function claimProfileAction(_prev: ClaimState, _formData: FormData): Promise<ClaimState> {
  const professional = await requireClaimableProfessional();
  const authkitUser = await currentAuthKitUser();
  if (!authkitUser) redirect('/pro'); // shouldn't happen — middleware already gates /pro/*

  let claimed: PortalProfessional;
  try {
    ({ professional: claimed } = await claimProfessional(professional.id, authkitUser.id, authkitUser.email));
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Claiming this profile failed. Try again.' };
  }
  redirect(portalDestination(claimed));
}

export interface ApplyState {
  error: string | null;
}

// Self-application: creates a brand-new professionals row bound to the
// caller's AuthKit account in one step (distinct from claimProfileAction,
// which links an account to a pre-existing row). Anyone who already has a
// row — claimed or claimable — is turned away rather than allowed to apply
// twice; the orchestrator's unique index on authkit_user_id would reject a
// second row anyway, but checking here gives a clean error instead of a
// generic "failed" message.
export async function applyProfileAction(_prev: ApplyState, formData: FormData): Promise<ApplyState> {
  const authkitUser = await currentAuthKitUser();
  if (!authkitUser) redirect('/pro'); // shouldn't happen — middleware already gates /pro/*

  const existing = await peekOwnedProfessional();
  if (existing) redirect(portalDestination(existing));

  const displayName = String(formData.get('displayName') ?? '').trim();
  const whatsapp = String(formData.get('whatsapp') ?? '').trim();
  const category = String(formData.get('category') ?? '') as ProfessionalCategory;
  const affiliation = String(formData.get('affiliation') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const bio = String(formData.get('bio') ?? '').trim();

  if (!displayName || !whatsapp || !category) {
    return { error: 'Name, WhatsApp number, and category are required.' };
  }

  const input: ApplyProfessionalInput = {
    displayName,
    whatsapp,
    category,
    authkitUserId: authkitUser.id,
    authkitEmail: authkitUser.email,
    ...(affiliation ? { affiliation } : {}),
    ...(title ? { title } : {}),
    ...(bio ? { bio } : {}),
  };

  let professional: PortalProfessional;
  try {
    ({ professional } = await applyAsProfessional(input));
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Submitting your application failed. Try again.' };
  }

  const jar = await cookies();
  jar.set(PRO_COOKIE, professional.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  redirect(portalDestination(professional));
}

export async function togglePrivacyAction(formData: FormData): Promise<void> {
  const professional = await requireOwnedProfessional();
  await putProPrivacy(professional.id, formData.get('showLocation') === 'true');
  redirect('/pro/dashboard');
}

export async function toggleStatusAction(formData: FormData): Promise<void> {
  const professional = await requireOwnedProfessional();
  await putProStatus(professional.id, formData.get('available') === 'true');
  redirect('/pro/dashboard');
}

export async function saveSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const professional = await requireOwnedProfessional();
  const fee = String(formData.get('directMessageFee') ?? '').trim();
  const dmNote = String(formData.get('dmNote') ?? '').trim();
  if (!fee || Number.isNaN(Number(fee)) || Number(fee) < 0) {
    return { error: 'The message fee must be a number (0 turns the fee off).' };
  }
  try {
    await putProSettings(professional.id, { directMessageFee: fee, ...(dmNote ? { dmNote } : {}) });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Saving failed. Try again.' };
  }
  return { error: null, saved: true };
}

export async function saveAvailabilityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const professional = await requireOwnedProfessional();

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
    await putProAvailability(professional.id, true, slots);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Saving failed. Try again.' };
  }
  return { error: null, saved: true };
}
