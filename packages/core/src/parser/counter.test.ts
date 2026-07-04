import { describe, expect, it } from 'vitest';
import { parseCounterSlots } from './counter.js';

// Fixed reference: Wednesday 2026-07-01 09:00 UTC.
const REF = new Date('2026-07-01T09:00:00Z');

describe('parseCounterSlots', () => {
  it('parses up to three natural-language lines', () => {
    const result = parseCounterSlots('tomorrow 2pm\nFriday 10:30\nSaturday 9am', REF);

    expect(result.rejected).toEqual([]);
    expect(result.overflow).toEqual([]);
    expect(result.slots).toHaveLength(3);
    expect(result.slots.map((s) => s.raw)).toEqual(['tomorrow 2pm', 'Friday 10:30', 'Saturday 9am']);
    // All strictly in the future relative to the reference.
    for (const slot of result.slots) {
      expect(slot.start.getTime()).toBeGreaterThan(REF.getTime());
    }
    // "tomorrow 2pm" is 2026-07-02 at 14:00 local-to-parse.
    expect(result.slots[0]!.start.toISOString().slice(0, 10)).toBe('2026-07-02');
  });

  it('parses explicit dates and times', () => {
    const result = parseCounterSlots('3 July 15:00\n2026-07-10 08:30', REF);
    expect(result.slots).toHaveLength(2);
    expect(result.slots[0]!.start.toISOString().slice(0, 10)).toBe('2026-07-03');
    expect(result.slots[1]!.start.toISOString().slice(0, 10)).toBe('2026-07-10');
  });

  it('unparseable lines are rejected with reason, not guessed', () => {
    const result = parseCounterSlots('tomorrow 2pm\nwhenever works\nblargh', REF);
    expect(result.slots).toHaveLength(1);
    expect(result.rejected).toEqual([
      { raw: 'whenever works', reason: 'UNPARSEABLE' },
      { raw: 'blargh', reason: 'UNPARSEABLE' },
    ]);
  });

  it('forwardDate pushes ambiguous weekday names into the future, and past datetimes are rejected', () => {
    // "Monday" from a Wednesday reference must be the NEXT Monday.
    const forward = parseCounterSlots('Monday 10am', REF);
    expect(forward.slots).toHaveLength(1);
    expect(forward.slots[0]!.start.getTime()).toBeGreaterThan(REF.getTime());

    // A fully explicit past datetime cannot be forwarded -> rejected.
    const past = parseCounterSlots('2026-06-01 10:00', REF);
    expect(past.slots).toHaveLength(0);
    expect(past.rejected).toEqual([{ raw: '2026-06-01 10:00', reason: 'IN_PAST' }]);
  });

  it('caps at three slots and reports the overflow', () => {
    const result = parseCounterSlots('tomorrow 9am\ntomorrow 10am\ntomorrow 11am\ntomorrow 12pm\ntomorrow 1pm', REF);
    expect(result.slots).toHaveLength(3);
    expect(result.overflow).toEqual(['tomorrow 12pm', 'tomorrow 1pm']);
  });

  it('ignores blank lines and trims whitespace', () => {
    const result = parseCounterSlots('\n  tomorrow 2pm  \n\n\n', REF);
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]!.raw).toBe('tomorrow 2pm');
  });

  it('empty input yields nothing', () => {
    expect(parseCounterSlots('', REF)).toEqual({ slots: [], rejected: [], overflow: [] });
  });
});
