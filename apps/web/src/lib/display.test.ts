import { describe, expect, it } from 'vitest';
import { REQUEST_STATES } from '@marketplace/core';
import { STATE_COPY, TERMINAL_STATES, formatMoney, formatWhen } from './display';

describe('display helpers', () => {
  it('has copy for every backend request state', () => {
    for (const state of REQUEST_STATES) {
      expect(STATE_COPY[state], state).toBeDefined();
    }
  });

  it('terminal states match the backend contract', () => {
    expect([...TERMINAL_STATES].sort()).toEqual(['CANCELLED', 'COMPLETED', 'NO_SHOW_CLIENT', 'REFUNDED']);
  });

  it('formats money with trimmed currency', () => {
    expect(formatMoney('3500.00', 'KES')).toBe('KES 3500.00');
    expect(formatMoney('3500.00', 'KES ')).toBe('KES 3500.00'); // char(3) pads
  });

  it('formats datetimes in Nairobi time', () => {
    expect(formatWhen('2026-08-03T14:00:00Z')).toContain('17:00');
  });
});
