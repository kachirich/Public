import Link from 'next/link';
import { PrintButton } from '@/components/print-button';
import { categoryLabel } from '@/lib/display';
import { requireOwnedProfessional } from '@/lib/pro-actions';

export const dynamic = 'force-dynamic';

// Printable QR poster for a professional to post at their office/department.
// The controls (print/download/back) are hidden when printing; only the
// poster card lands on paper.
export default async function PosterPage() {
  const professional = await requireOwnedProfessional();
  const professionalId = professional.id;

  return (
    <>
      <div className="poster-controls">
        <Link href="/pro/dashboard" className="row-link">
          ← Back to dashboard
        </Link>
        <div className="calendar-links">
          <PrintButton />
          <a className="button-link button-secondary" href={`/api/professionals/${professionalId}/qr?format=png`} download>
            Download PNG
          </a>
        </div>
      </div>

      <div className="poster">
        <p className="poster-kicker">Professional Access</p>
        <h1 className="poster-name">{professional.display_name}</h1>
        <p className="poster-meta">
          <span className="chip" data-category={professional.category}>
            {categoryLabel(professional.category)}
          </span>
          {professional.title && <span> {professional.title}</span>}
        </p>
        {professional.affiliation && <p className="poster-affiliation">{professional.affiliation}</p>}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="poster-qr" src={`/api/professionals/${professionalId}/qr?format=svg`} alt="Booking QR code" />

        <p className="poster-cta">Scan to book a session</p>
        <p className="poster-foot">Pay securely · funds held in escrow until your session happens</p>
      </div>
    </>
  );
}
