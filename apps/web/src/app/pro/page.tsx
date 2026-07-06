import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ProLoginForm } from '@/components/pro-login-form';
import { peekOwnedProfessional } from '@/lib/pro-actions';
import { portalDestination } from '@/lib/portal-destination';

export const dynamic = 'force-dynamic';

export default async function ProLoginPage() {
  const professional = await peekOwnedProfessional();
  if (professional) redirect(portalDestination(professional));
  return (
    <>
      <section className="hero">
        <h1>Provider portal</h1>
        <p>
          For verified professionals and registered service businesses. Manage your availability,
          see your upcoming bookings, and control what clients can book.
        </p>
      </section>
      <div className="card">
        <h2>Sign in</h2>
        <ProLoginForm />
      </div>
      <div className="card">
        <h2>New here?</h2>
        <p className="pro-affiliation">Not listed yet? Apply for a professional account.</p>
        <Link className="button-link button-secondary" href="/pro/apply">
          Apply for a professional account
        </Link>
      </div>
      <div className="card">
        <h2>Run a service business?</h2>
        <p className="pro-affiliation">
          Salons, garages, clinics and other businesses can register in a minute — no professional
          registry needed — and start taking early bookings by QR code.
        </p>
        <Link className="button-link" href="/pro/register">
          Register your business
        </Link>
      </div>
    </>
  );
}
