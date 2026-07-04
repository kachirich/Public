// Server-side client for the orchestrator API. Only ever imported from
// Server Components, Server Actions, and Route Handlers — the browser never
// talks to the orchestrator directly (no CORS surface, no leaked internals).

const BASE_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';

export interface Professional {
  id: string;
  display_name: string;
}

export interface Transition {
  from_state: string;
  to_state: string;
  actor: string;
  reason_code: string | null;
  created_at: string;
}

export interface CounterSlot {
  id: string;
  slotStart: string;
  durationMinutes: number;
  tier: string;
  priceGross: string;
}

export interface RequestView {
  id: string;
  ref_code: string;
  state: string;
  tier: string;
  session_start: string;
  duration_minutes: number;
  currency: string;
  price_gross: string;
  platform_fee: string;
  payout_net: string;
  card_expires_at: string | null;
  professional_name: string;
  transitions: Transition[];
  counterOffer: { id: string; expires_at: string; slots: CounterSlot[] } | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export function listProfessionals(): Promise<{ professionals: Professional[] }> {
  return call('/professionals');
}

export function findOrCreateClient(input: { displayName: string; email: string; phone?: string }): Promise<{ clientId: string }> {
  return call('/clients', { method: 'POST', body: JSON.stringify(input) });
}

export function createQuote(input: {
  clientId: string;
  professionalId: string;
  sessionStart: string;
  durationMinutes: number;
  brief: string;
}): Promise<{ requestId: string; refCode: string; tier: string; priceGross: string; currency: string }> {
  return call('/quotes', { method: 'POST', body: JSON.stringify(input) });
}

export function initPayment(requestId: string): Promise<{ authorizationUrl: string }> {
  return call(`/quotes/${requestId}/pay`, { method: 'POST' });
}

export function getRequest(requestId: string): Promise<RequestView> {
  return call(`/requests/${requestId}`);
}

export function chooseCounterSlot(counterOfferId: string, slotId: string): Promise<{ accepted: boolean }> {
  return call(`/counter-offers/${counterOfferId}/choose`, { method: 'POST', body: JSON.stringify({ slotId }) });
}
