import { ClaimForm } from '@/components/claim-form';
import { categoryLabel, initials } from '@/lib/display';
import { requireClaimableProfessional } from '@/lib/pro-actions';

export const dynamic = 'force-dynamic';

const CLAIM_STATUS_COPY: Record<string, string> = {
  UNCLAIMED: 'This listing has not been claimed by anyone yet.',
  HOSPITAL_VERIFIED: "Your institution has confirmed this listing, but it's not yet linked to an account.",
};

// Shown right after WhatsApp OTP verification when the matched profile
// isn't FULLY_ACTIVATED yet — the professional confirms it's really them
// before the AuthKit account they just signed in with gets bound to it.
export default async function ClaimPage() {
  const professional = await requireClaimableProfessional();

  return (
    <>
      <section className="hero">
        <h1>Confirm it&apos;s you</h1>
        <p>{CLAIM_STATUS_COPY[professional.claimStatus] ?? 'One more step before you can access your dashboard.'}</p>
      </section>

      <div className="card pro-header">
        <span className="avatar avatar-lg" data-category={professional.category} aria-hidden>
          {initials(professional.display_name)}
        </span>
        <div style={{ flex: 1 }}>
          <h1>{professional.display_name}</h1>
          <p className="pro-header-meta">
            <span className="chip" data-category={professional.category}>
              {categoryLabel(professional.category)}
            </span>
            {professional.affiliation && <span>{professional.affiliation}</span>}
          </p>
          {professional.title && <p className="pro-affiliation">{professional.title}</p>}
        </div>
      </div>

      <div className="card">
        <h2>Is this your listing?</h2>
        <p className="pro-affiliation">
          Claiming links this listing to the account you just signed in with. You&apos;ll be the only one able to
          manage availability, messages, and bookings for it from now on.
        </p>
        <ClaimForm />
      </div>
    </>
  );
}
