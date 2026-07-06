import { notFound } from 'next/navigation';
import { AskForm } from '@/components/ask-form';
import { BookingForm } from '@/components/booking-form';
import { ApiError, getProfessional } from '@/lib/api';
import { categoryLabel, formatMoney, initials } from '@/lib/display';

export const dynamic = 'force-dynamic';

export default async function ProfessionalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ message?: string; src?: string }>;
}) {
  const { id } = await params;
  const { message, src } = await searchParams;
  const source = src === 'qr' ? 'qr' : undefined;
  let professional;
  try {
    professional = await getProfessional(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <>
      <div className="card pro-header">
        <span className="avatar avatar-lg" data-category={professional.category} aria-hidden>
          {initials(professional.display_name)}
        </span>
        <div>
          <h1>{professional.display_name}</h1>
          <p className="pro-header-meta">
            <span className="chip" data-category={professional.category}>
              {categoryLabel(professional.category)}
            </span>
            <span className="status-dot" data-available={professional.is_available}>
              {professional.is_available ? 'Available' : 'Not available'}
            </span>
            {professional.title && <span>{professional.title}</span>}
          </p>
          {professional.business_name && <p className="pro-affiliation">{professional.business_name}</p>}
          {professional.affiliation && <p className="pro-affiliation">{professional.affiliation}</p>}
          {professional.bio && <p className="pro-bio">{professional.bio}</p>}
          {professional.provider_type !== 'SERVICE' && <p className="verified">✓ Verified professional</p>}
        </div>
      </div>

      {message === 'sent' && (
        <div className="card">
          <p className="verified">✓ Payment received — your message is on its way to {professional.display_name}.</p>
        </div>
      )}

      {professional.is_available ? (
        <div className="card">
          <h2>Request a session</h2>
          <BookingForm professionalId={id} source={source} />
        </div>
      ) : (
        <div className="card">
          <h2>Not taking bookings right now</h2>
          <p className="pro-affiliation">
            {professional.display_name} has paused new sessions. You can still send a message below,
            or check back later.
          </p>
        </div>
      )}

      <div className="card">
        <h2>Just have a question?</h2>
        <p className="pro-affiliation">
          Send a short message for {formatMoney(professional.direct_message_fee ?? '50.00', 'KES')}. The small fee keeps
          spam out of {professional.display_name.split(' ')[0]}&apos;s inbox, so real questions get read.
        </p>
        <AskForm professionalId={id} feeLine={formatMoney(professional.direct_message_fee ?? '50.00', 'KES')} source={source} />
      </div>
    </>
  );
}
