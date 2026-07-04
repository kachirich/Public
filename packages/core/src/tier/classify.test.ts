import { describe, expect, it } from 'vitest';
import { cardExpiresAt, classifyTier } from './classify.js';

const NOW = new Date('2026-07-01T09:00:00Z');
// Working hours today: 08:00–17:00 UTC.
const TODAY_AVAILABILITY = [{ start: new Date('2026-07-01T08:00:00Z'), end: new Date('2026-07-01T17:00:00Z') }];

function classify(overrides: Partial<Parameters<typeof classifyTier>[0]>) {
  return classifyTier({
    requestedStart: new Date('2026-07-01T14:00:00Z'),
    durationMinutes: 60,
    now: NOW,
    availability: TODAY_AVAILABILITY,
    isWorkingDay: true,
    ...overrides,
  });
}

describe('classifyTier', () => {
  it('inside availability on a working day = IN_HOURS', () => {
    expect(classify({})).toBe('IN_HOURS');
  });

  it('outside hours on a working day = OFF_DUTY', () => {
    expect(classify({ requestedStart: new Date('2026-07-01T19:00:00Z') })).toBe('OFF_DUTY');
  });

  it('session overflowing past the availability window is not IN_HOURS', () => {
    // Starts inside (16:30) but runs to 17:30, past the 17:00 close.
    expect(classify({ requestedStart: new Date('2026-07-01T16:30:00Z') })).toBe('OFF_DUTY');
  });

  it('non-working day = OFF_DAY', () => {
    expect(classify({ requestedStart: new Date('2026-07-04T14:00:00Z'), availability: [], isWorkingDay: false })).toBe('OFF_DAY');
  });

  it('start within 60 minutes = PREMIUM_INTERRUPT, overriding everything', () => {
    // Inside availability AND within the interrupt window -> still PREMIUM.
    expect(classify({ requestedStart: new Date('2026-07-01T09:30:00Z') })).toBe('PREMIUM_INTERRUPT');
    // On a blocked day too.
    expect(classify({ requestedStart: new Date('2026-07-01T09:45:00Z'), availability: [], isWorkingDay: false })).toBe('PREMIUM_INTERRUPT');
    // Exactly at the boundary counts as premium.
    expect(classify({ requestedStart: new Date('2026-07-01T10:00:00Z') })).toBe('PREMIUM_INTERRUPT');
    // Just past the boundary does not.
    expect(classify({ requestedStart: new Date('2026-07-01T10:01:00Z') })).toBe('IN_HOURS');
  });
});

describe('cardExpiresAt', () => {
  it('scales the acceptance deadline with the tier', () => {
    expect(cardExpiresAt('PREMIUM_INTERRUPT', NOW).toISOString()).toBe('2026-07-01T09:15:00.000Z');
    expect(cardExpiresAt('OFF_DUTY', NOW).toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(cardExpiresAt('OFF_DAY', NOW).toISOString()).toBe('2026-07-01T21:00:00.000Z');
    expect(cardExpiresAt('IN_HOURS', NOW).toISOString()).toBe('2026-07-01T21:00:00.000Z');
  });
});
