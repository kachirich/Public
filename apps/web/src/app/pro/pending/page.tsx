import { categoryLabel, initials } from '@/lib/display';
import { proLogoutAction, requirePendingProfessional } from '@/lib/pro-actions';

export const dynamic = 'force-dynamic';

const STATUS_COPY: Record<string, { title: string; detail: string }> = {
  PENDING_VERIFICATION: {
    title: 'Application submitted',
    detail:
      'We’re checking your details against your professional registry and confirming your WhatsApp number. This usually takes a couple of business days.',
  },
  NEEDS_MANUAL_REVIEW: {
    title: 'Under manual review',
    detail: 'An automated check didn’t come back clean, so a member of our team is reviewing your application by hand.',
  },
  REJECTED: {
    title: 'Application rejected',
    detail: 'We couldn’t verify your details. Contact support if you think this is a mistake.',
  },
};

// Landing spot for a FULLY_ACTIVATED professional whose verification_status
// isn't VERIFIED yet — reachable today only right after self-application.
export default async function PendingPage() {
  const professional = await requirePendingProfessional();
  const copy = STATUS_COPY[professional.verificationStatus] ?? STATUS_COPY.PENDING_VERIFICATION!;

  return (
    <>
      <section className="hero">
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
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
        </div>
        <div className="header-actions">
          <form action={proLogoutAction}>
            <button type="submit" className="button-secondary-solid">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
