import { getRequest } from '@/lib/api';
import { RequestStatus } from '@/components/request-status';

export const dynamic = 'force-dynamic';

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // First paint is server-rendered; the client component takes over polling.
  const initialData = await getRequest(id);
  return <RequestStatus requestId={id} initialData={initialData} />;
}
