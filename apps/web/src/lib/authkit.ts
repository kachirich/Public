// Edge-safe bridge to apps/authkit-service — importable from middleware.ts
// (Edge runtime), which is why this file has zero Node-only dependencies
// (no `next/headers`, no `cookies()`). Server-Action-only helpers that do
// need those live in authkit-server.ts instead.
//
// Never imported by a 'use client' component — the browser never talks to
// authkit-service directly from this app; it only ever sees redirects to it.

const AUTHKIT_URL = process.env.AUTHKIT_URL ?? 'http://localhost:4000';
export const AUTHKIT_COOKIE_NAME = 'authkit_jwt';

export interface AuthKitUser {
  id: string;
  email: string;
  name: string | null;
}

// Verifies a session by asking authkit-service itself, rather than
// decoding the JWT locally — this is what makes server-side logout
// revocation (authkit's revoked_tokens/jti check) actually take effect
// here too, and avoids sharing JWT_SECRET across two independently
// deployed services. Fails closed: any network error is treated as
// unauthenticated, matching an auth gate's correct default.
export async function fetchAuthKitUser(jwt: string): Promise<AuthKitUser | null> {
  try {
    const res = await fetch(`${AUTHKIT_URL}/api/auth/me`, {
      headers: { cookie: `${AUTHKIT_COOKIE_NAME}=${jwt}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const { user } = await res.json();
    return user as AuthKitUser;
  } catch {
    return null;
  }
}

export async function revokeAuthKitSession(jwt: string | undefined): Promise<void> {
  if (!jwt) return;
  try {
    await fetch(`${AUTHKIT_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: `${AUTHKIT_COOKIE_NAME}=${jwt}` },
    });
  } catch {
    // Best effort — the cookie gets cleared client-side regardless, and an
    // expired/already-invalid token has nothing to revoke anyway.
  }
}

// Cookie flags mirror authkit-service's own (see apps/authkit-service/jwt.js)
// so a delete actually matches the cookie that was set, including the
// shared Domain attribute in production.
export function authKitCookieOptions() {
  const domain = process.env.AUTHKIT_COOKIE_DOMAIN?.trim();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

export function buildAuthKitLoginUrl(origin: string, pathname: string, search: string): string {
  const returnTo = encodeURIComponent(`${origin}${pathname}${search}`);
  return `${AUTHKIT_URL}/login.html?returnTo=${returnTo}`;
}
