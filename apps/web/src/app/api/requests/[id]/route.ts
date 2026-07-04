import { NextResponse } from 'next/server';
import { ApiError, getRequest } from '@/lib/api';

// Browser polling endpoint: proxies the orchestrator server-side so the
// client never needs CORS or the orchestrator's address.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await getRequest(id));
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'upstream unavailable' }, { status: 502 });
  }
}
