'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ActionState } from './actions';
import { currentAuthKitUser, logoutAuthKit } from './authkit-server';
import { decideVerification, setProfessionalActive } from './admin-api';

const ADMIN_COOKIE = 'admin_session';
// Deployments set ADMIN_TOKEN; the dev default keeps the portal testable.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin';

// Two factors, mirroring the professional portal's shape: middleware.ts
// already requires a valid AuthKit session for everything under /admin —
// this file only ever needs to worry about the token layer on top of that.
export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(ADMIN_COOKIE)?.value === ADMIN_TOKEN;
}

export async function adminLoginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get('token') ?? '');
  if (token !== ADMIN_TOKEN) return { error: 'Wrong admin token.' };
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  redirect('/admin/dashboard');
}

export async function adminLogoutAction(): Promise<void> {
  await logoutAuthKit();
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
  redirect('/admin');
}

export async function decideVerificationAction(formData: FormData): Promise<void> {
  if (!(await isAdmin())) redirect('/admin');
  const id = String(formData.get('verificationId'));
  const decision = String(formData.get('decision')) as 'approve' | 'reject';
  const authkitUser = await currentAuthKitUser();
  await decideVerification(id, decision, authkitUser?.email ?? 'admin-portal');
  redirect('/admin/dashboard');
}

export async function setActiveAction(formData: FormData): Promise<void> {
  if (!(await isAdmin())) redirect('/admin');
  const id = String(formData.get('professionalId'));
  await setProfessionalActive(id, formData.get('active') === 'true');
  redirect('/admin/dashboard');
}
