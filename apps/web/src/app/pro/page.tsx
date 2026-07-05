import { redirect } from 'next/navigation';
import { ProLoginForm } from '@/components/pro-login-form';
import { currentProfessionalId } from '@/lib/pro-actions';

export const dynamic = 'force-dynamic';

export default async function ProLoginPage() {
  if (await currentProfessionalId()) redirect('/pro/dashboard');
  return (
    <>
      <section className="hero">
        <h1>Professional portal</h1>
        <p>
          For verified professionals only. Manage your weekly availability, see your upcoming
          sessions, and control what clients can book.
        </p>
      </section>
      <div className="card">
        <h2>Sign in</h2>
        <ProLoginForm />
      </div>
    </>
  );
}
