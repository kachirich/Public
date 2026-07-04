export const REQUEST_STATES = [
  'REQUESTED',
  'PENDING_PAYMENT',
  'HELD',
  'COUNTER_OFFERED',
  'ACCEPTED',
  'IN_SESSION',
  'COMPLETED',
  'DECLINED',
  'EXPIRED',
  'NO_SHOW_PROFESSIONAL',
  'NO_SHOW_CLIENT',
  'REFUNDED',
  'CANCELLED',
] as const;

export type RequestState = (typeof REQUEST_STATES)[number];

export type ActorType = 'CLIENT' | 'PROFESSIONAL' | 'SYSTEM' | 'TIMER';

// The request lifecycle as a literal data table. transition() consults this
// map and nothing else; changing the lifecycle means changing this map.
export const VALID_TRANSITIONS: Readonly<Record<RequestState, readonly RequestState[]>> = {
  REQUESTED: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT: ['HELD', 'CANCELLED'],
  HELD: ['ACCEPTED', 'DECLINED', 'EXPIRED', 'COUNTER_OFFERED'],
  COUNTER_OFFERED: ['ACCEPTED', 'DECLINED', 'EXPIRED'],
  ACCEPTED: ['IN_SESSION', 'NO_SHOW_PROFESSIONAL', 'NO_SHOW_CLIENT'],
  IN_SESSION: ['COMPLETED', 'NO_SHOW_PROFESSIONAL', 'NO_SHOW_CLIENT'],
  DECLINED: ['REFUNDED'],
  EXPIRED: ['REFUNDED'],
  NO_SHOW_PROFESSIONAL: ['REFUNDED'],
  NO_SHOW_CLIENT: [],
  COMPLETED: [],
  REFUNDED: [],
  CANCELLED: [],
};

export const TERMINAL_STATES: readonly RequestState[] = ['REFUNDED', 'COMPLETED', 'NO_SHOW_CLIENT', 'CANCELLED'];

export function isLegalTransition(from: RequestState, to: RequestState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
