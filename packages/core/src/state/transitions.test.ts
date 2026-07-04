import { describe, expect, it } from 'vitest';
import { isLegalTransition, REQUEST_STATES, TERMINAL_STATES, VALID_TRANSITIONS } from './transitions.js';

describe('transition table', () => {
  it('matches the spec exactly', () => {
    expect(VALID_TRANSITIONS).toEqual({
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
    });
  });

  it('terminal states have no outgoing transitions', () => {
    for (const state of TERMINAL_STATES) {
      expect(VALID_TRANSITIONS[state]).toEqual([]);
    }
  });

  it('every state appears in the table', () => {
    expect(Object.keys(VALID_TRANSITIONS).sort()).toEqual([...REQUEST_STATES].sort());
  });

  it('isLegalTransition agrees with the table', () => {
    expect(isLegalTransition('HELD', 'ACCEPTED')).toBe(true);
    expect(isLegalTransition('ACCEPTED', 'HELD')).toBe(false);
    expect(isLegalTransition('COMPLETED', 'REFUNDED')).toBe(false);
  });
});
