import { redirect } from 'next/navigation';
import { ApplyForm } from '@/components/apply-form';
import { peekOwnedProfessional } from '@/lib/pro-actions';
import { portalDestination } from '@/lib/portal-destination';

export const dynamic = 'force-dynamic';

// Self-application: for someone with no existing professionals row at all.
// Distinct from the WhatsApp-OTP + claim flow, which is for pre-populated
// listings. Anyone who already has a row gets redirected to wherever it
// actually is instead of being shown a form that would just 409.
export default async function ApplyPage() {
  const existing = await peekOwnedProfessional();
  if (existing) redirect(portalDestination(existing));

  return (
    <>
      <section className="hero">
        <h1>Apply for a professional account</h1>
        <p>
          Not listed yet? Tell us a bit about yourself. We&apos;ll check your details against your
          professional registry and confirm your WhatsApp number before your listing goes live.
        </p>
      </section>
      <div className="card">
        <ApplyForm />
      </div>
    </>
  );
}
