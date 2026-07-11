import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

// Development helper: GET /pro/dev-login?id=<professionalId> sets the portal
// cookie and lands on the dashboard. Lets headless-browser smoke tests and
// screenshots skip the login form. Hard-disabled outside development.
export async function GET(req: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return new Response('not found', { status: 404 });
  }
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return new Response('missing id', { status: 400 });
  const jar = await cookies();
  jar.set('pro_id', id, { httpOnly: true, sameSite: 'lax', path: '/' });
  redirect('/pro/dashboard');
}
