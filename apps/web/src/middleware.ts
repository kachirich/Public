import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { fetchAuthKitUser, buildAuthKitLoginUrl, AUTHKIT_COOKIE_NAME } from '@/lib/authkit';

// Centralized AuthKit gate for the professional and admin portals. This is
// the one place that enforces "must have a valid AuthKit session" for
// everything under /pro and /admin — including server actions POSTed back
// to those same paths, since Next.js re-runs middleware for those requests
// too. Routes themselves stay unaware of AuthKit entirely; they only ever
// see the existing pro_id / admin_session cookies as before.
//
// This is a REQUIRED SECOND FACTOR, not a replacement: passing this gate
// only proves "a real AuthKit account is signed in," not "this is the
// right professional." /pro/dashboard and /pro/claim still separately
// require the WhatsApp-OTP-issued pro_id cookie, and each page verifies
// the AuthKit session actually matches the professional it's about to
// show (see lib/pro-actions.ts) — closing the gap where any AuthKit
// account plus a guessed/forged pro_id cookie would otherwise reach
// someone else's dashboard.
export const config = {
  matcher: ['/pro/:path*', '/admin/:path*'],
};

export async function middleware(req: NextRequest) {
  const { pathname, search, origin } = req.nextUrl;

  // Dev-only headless-testing shortcut (hard-disabled outside development
  // in the route itself); everything it redirects to is still gated.
  if (pathname === '/pro/dev-login') return NextResponse.next();

  const jwt = req.cookies.get(AUTHKIT_COOKIE_NAME)?.value;
  const user = jwt ? await fetchAuthKitUser(jwt) : null;

  if (!user) {
    return NextResponse.redirect(buildAuthKitLoginUrl(origin, pathname, search));
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-authkit-user-id', user.id);
  requestHeaders.set('x-authkit-email', user.email);
  if (user.name) requestHeaders.set('x-authkit-name', user.name);
  return NextResponse.next({ request: { headers: requestHeaders } });
}
