// Server-side bridge to the orchestrator's /internal/* admin endpoints.
// Authenticated with the shared internal secret — never sent to the browser.

const BASE_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';
const INTERNAL_SECRET = process.env.INTERNAL_SHARED_SECRET ?? 'dev-secret-key-change-in-production';

export interface PendingVerification {
  id: string;
  professional_id: string;
  display_name: string;
  registry: string;
  registration_number: string;
  submitted_name: string;
  registry_name: string | null;
  name_match_score: string | null;
  whatsapp_otp_passed: boolean;
  created_at: string;
}

export interface AdminProfessional {
  id: string;
  display_name: string;
  whatsapp_e164: string;
  category: string;
  affiliation: string | null;
  verification_status: string;
  is_active: boolean;
  is_available: boolean;
  created_at: string;
}

async function internalCall<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET, ...init?.headers },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export function listPendingVerifications(): Promise<{ pending: PendingVerification[] }> {
  return internalCall('/internal/verifications/pending');
}

export function decideVerification(id: string, decision: 'approve' | 'reject', reviewedBy: string): Promise<unknown> {
  return internalCall(`/internal/verifications/${id}/decide`, {
    method: 'POST',
    body: JSON.stringify({ decision, reviewedBy }),
  });
}

export function listAllProfessionals(): Promise<{ professionals: AdminProfessional[] }> {
  return internalCall('/internal/professionals');
}

export function setProfessionalActive(id: string, active: boolean): Promise<unknown> {
  return internalCall(`/internal/professionals/${id}/active`, {
    method: 'PUT',
    body: JSON.stringify({ active }),
  });
}
