import { getRequest } from '@/lib/api';
import { buildIcs } from '@/lib/display';

// Downloadable calendar file for a confirmed session.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const request = await getRequest(id);
  const ics = buildIcs({
    refCode: request.ref_code,
    professionalName: request.professional_name,
    sessionStart: request.session_start,
    durationMinutes: request.duration_minutes,
  });
  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="session-${request.ref_code}.ics"`,
    },
  });
}
