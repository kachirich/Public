import { BookingForm } from '@/components/booking-form';

export const dynamic = 'force-dynamic';

export default async function ProfessionalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <h1>Request a session</h1>
      <div className="card">
        <BookingForm professionalId={id} />
      </div>
    </>
  );
}
