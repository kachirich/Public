import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ProRegisterForm } from '@/components/pro-register-form';
import { currentProfessionalId } from '@/lib/pro-actions';

export const dynamic = 'force-dynamic';

export default async function ProRegisterPage() {
  if (await currentProfessionalId()) redirect('/pro/dashboard');
  return (
    <>
      <section className="hero">
        <h1>Register your business</h1>
        <p>
          Salons, garages, clinics, workshops — any service business can take early bookings here.
          Register your name and business, set your open hours and how many clients you can take at
          once, then print your QR poster so clients can scan and book ahead.
        </p>
      </section>
      <div className="card">
        <h2>Create your listing</h2>
        <ProRegisterForm />
        <p className="pro-affiliation">
          Already registered? <Link href="/pro">Sign in instead</Link>. Verified professionals
          (doctors, lawyers, lecturers…) are onboarded separately with registry verification.
        </p>
      </div>
    </>
  );
}
