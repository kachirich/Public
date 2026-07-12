import type { PortalProfessional } from './api';

// Where a professional lands once their pro_id cookie is set, based on the
// two orthogonal gates: claim_status (is this row bound to an account) and
// verification_status (is it bookable yet). Shared by every place that sets
// the cookie and needs to send the professional somewhere sensible next.
// Lives outside pro-actions.ts (a 'use server' module) because every
// top-level export of a 'use server' file must be an async Server Action —
// this is a plain synchronous helper.
export function portalDestination(professional: PortalProfessional): string {
  if (professional.claimStatus !== 'FULLY_ACTIVATED') return '/pro/claim';
  if (professional.verificationStatus !== 'VERIFIED') return '/pro/pending';
  return '/pro/dashboard';
}
