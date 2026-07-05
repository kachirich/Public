import { redirect } from 'next/navigation';
import { AdminLoginForm } from '@/components/admin-login-form';
import { isAdmin } from '@/lib/admin-actions';

export const dynamic = 'force-dynamic';

export default async function AdminLoginPage() {
  if (await isAdmin()) redirect('/admin/dashboard');
  return (
    <>
      <section className="hero">
        <h1>Admin</h1>
        <p>Verification review and roster management.</p>
      </section>
      <div className="card">
        <h2>Sign in</h2>
        <AdminLoginForm />
      </div>
    </>
  );
}
