// Server-Action/Server-Component-only AuthKit helpers — these use
// next/headers, which only works in the Node runtime, not Edge middleware.
// See lib/authkit.ts for the Edge-safe pieces middleware.ts actually uses.
import { cookies, headers } from 'next/headers';
import { AUTHKIT_COOKIE_NAME, authKitCookieOptions, revokeAuthKitSession, type AuthKitUser } from './authkit';

// Read-back for Server Components/Actions reached *after* middleware has
// already verified the session — avoids a second network round trip to
// authkit-service on every page render.
export async function currentAuthKitUser(): Promise<AuthKitUser | null> {
  const h = await headers();
  const id = h.get('x-authkit-user-id');
  const email = h.get('x-authkit-email');
  if (!id || !email) return null;
  return { id, email, name: h.get('x-authkit-name') };
}

// Shared by proLogoutAction and adminLogoutAction: revoke the AuthKit
// session server-side, then clear the cookie on this app's response too.
export async function logoutAuthKit(): Promise<void> {
  const jar = await cookies();
  const jwt = jar.get(AUTHKIT_COOKIE_NAME)?.value;
  await revokeAuthKitSession(jwt);
  jar.delete({ name: AUTHKIT_COOKIE_NAME, ...authKitCookieOptions() });
}
