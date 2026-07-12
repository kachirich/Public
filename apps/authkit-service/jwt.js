import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const COOKIE_NAME = 'authkit_jwt';

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not configured on the server');
  return s;
}

export function signSession(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, jti: crypto.randomUUID() },
    secret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  );
}

export function verifySession(token) {
  return jwt.verify(token, secret());
}

/**
 * Cookie flags follow OWASP session-management guidance: HttpOnly blocks JS
 * (XSS) access, Secure is forced in production (cookie never travels over
 * plain HTTP), SameSite=Lax blocks CSRF on cross-site POSTs while still
 * allowing top-level navigation (e.g. an email reset link).
 *
 * COOKIE_DOMAIN is deliberately opt-in via env rather than hardcoded: a
 * leading-dot Domain attribute (e.g. ".flowgateway.dev") is what makes the
 * cookie readable on every subdomain (book.flowgateway.dev included), but
 * that same syntax is invalid for "localhost" — so it must stay unset in
 * development and only be set in production.
 */
function cookieOptions(extra = {}) {
  const domain = process.env.COOKIE_DOMAIN?.trim();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(domain ? { domain } : {}),
    ...extra,
  };
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions({ maxAge: 7 * 24 * 60 * 60 * 1000 }));
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

export { COOKIE_NAME };
