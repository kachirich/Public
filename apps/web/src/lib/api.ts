// Server-side client for the orchestrator API. Only ever imported from
// Server Components, Server Actions, and Route Handlers — the browser never
// talks to the orchestrator directly (no CORS surface, no leaked internals).

const BASE_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';

export type ProfessionalCategory = 'DOCTOR' | 'LECTURER' | 'LAWYER' | 'ACCOUNTANT' | 'ENGINEER' | 'THERAPIST' | 'SERVICE';
export type ProviderType = 'PROFESSIONAL' | 'SERVICE';

export interface Professional {
  id: string;
  display_name: string;
  business_name?: string | null;
  provider_type?: ProviderType;
  category: ProfessionalCategory;
  affiliation: string | null;
  title: string | null;
  bio: string | null;
  location_area: string | null;
  is_available: boolean;
  direct_message_fee?: string;
}

// claim_status / authkit_user_id are portal-internal — deliberately kept
// off the public Professional type/endpoint (anyone can fetch a
// professional's public profile) and only returned from the /pro/*
// endpoints below, which are only ever called server-side from the
// AuthKit-gated portal.
export type ClaimStatus = 'UNCLAIMED' | 'HOSPITAL_VERIFIED' | 'FULLY_ACTIVATED';
export type VerificationStatus = 'PENDING_VERIFICATION' | 'VERIFIED' | 'NEEDS_MANUAL_REVIEW' | 'REJECTED';

export interface PortalProfessional {
  id: string;
  display_name: string;
  category: ProfessionalCategory;
  affiliation: string | null;
  title: string | null;
  location_area: string | null;
  is_available: boolean;
  claimStatus: ClaimStatus;
  authkitUserId: string | null;
  verificationStatus: VerificationStatus;
}

export interface AvailabilitySlot {
  weekday: number;
  startMinute: number;
  endMinute: number;
  capacity?: number;
}

export interface ProSession {
  id: string;
  ref_code: string;
  state: string;
  tier: string;
  session_start: string;
  duration_minutes: number;
  currency: string;
  payout_net: string;
  client_name: string;
  source: string | null;
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
  professional_category: ProfessionalCategory;
  professional_affiliation: string | null;
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

export function listProfessionals(filters: { category?: string; institution?: string } = {}): Promise<{ professionals: Professional[] }> {
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.institution) params.set('institution', filters.institution);
  const qs = params.toString();
  return call(`/professionals${qs ? `?${qs}` : ''}`);
}

export function listInstitutions(category?: string): Promise<{ institutions: string[] }> {
  return call(`/professionals/institutions${category ? `?category=${encodeURIComponent(category)}` : ''}`);
}

export function getProfessional(id: string): Promise<Professional> {
  return call(`/professionals/${id}`);
}

// ---------- professional portal ----------

export function proRegister(input: {
  displayName: string;
  businessName: string;
  whatsapp: string;
  flatPrice?: string;
}): Promise<{ providerId: string; challengeId: string; devCode?: string }> {
  return call('/pro/register', { method: 'POST', body: JSON.stringify(input) });
}

export function proLoginStart(whatsapp: string): Promise<{ challengeId: string; devCode?: string }> {
  return call('/pro/login', { method: 'POST', body: JSON.stringify({ whatsapp }) });
}

export function proLoginVerify(challengeId: string, code: string): Promise<{ professional: PortalProfessional }> {
  return call('/pro/login/verify', { method: 'POST', body: JSON.stringify({ challengeId, code }) });
}

export function getProForPortal(id: string): Promise<{ professional: PortalProfessional }> {
  return call(`/pro/${id}`);
}

export function claimProfessional(
  id: string,
  authkitUserId: string,
  authkitEmail: string,
): Promise<{ professional: PortalProfessional }> {
  return call(`/pro/${id}/claim`, { method: 'POST', body: JSON.stringify({ authkitUserId, authkitEmail }) });
}

export interface ApplyProfessionalInput {
  displayName: string;
  whatsapp: string;
  email?: string;
  category: ProfessionalCategory;
  affiliation?: string;
  title?: string;
  bio?: string;
  authkitUserId: string;
  authkitEmail: string;
}

// Self-application: no pre-existing row to claim, so this creates one and
// binds it to the caller's AuthKit account in the same request.
export function applyAsProfessional(input: ApplyProfessionalInput): Promise<{ professional: PortalProfessional }> {
  return call('/pro/apply', { method: 'POST', body: JSON.stringify(input) });
}

export function getProAvailability(id: string): Promise<{ consentedAt: string | null; slots: AvailabilitySlot[] }> {
  return call(`/pro/${id}/availability`);
}

export function putProAvailability(id: string, consent: boolean, slots: AvailabilitySlot[]): Promise<{ saved: boolean }> {
  return call(`/pro/${id}/availability`, { method: 'PUT', body: JSON.stringify({ consent, slots }) });
}

export function listProSessions(id: string): Promise<{ sessions: ProSession[] }> {
  return call(`/pro/${id}/sessions`);
}

export function putProStatus(id: string, available: boolean): Promise<{ saved: boolean; available: boolean }> {
  return call(`/pro/${id}/status`, { method: 'PUT', body: JSON.stringify({ available }) });
}

export function putProPrivacy(id: string, showLocation: boolean): Promise<{ saved: boolean }> {
  return call(`/pro/${id}/privacy`, { method: 'PUT', body: JSON.stringify({ showLocation }) });
}

export function getProSettings(
  id: string,
): Promise<{ directMessageFee: string; dmNote: string | null; showLocation: boolean; locationArea: string | null }> {
  return call(`/pro/${id}/settings`);
}

export function putProSettings(id: string, settings: { directMessageFee: string; dmNote?: string }): Promise<{ saved: boolean }> {
  return call(`/pro/${id}/settings`, { method: 'PUT', body: JSON.stringify(settings) });
}

export function sendDirectMessage(
  professionalId: string,
  input: { clientId: string; body: string; source?: string },
): Promise<{ directMessageId: string; fee: string; currency: string; authorizationUrl: string }> {
  return call(`/professionals/${professionalId}/messages`, { method: 'POST', body: JSON.stringify(input) });
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
  source?: string;
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
