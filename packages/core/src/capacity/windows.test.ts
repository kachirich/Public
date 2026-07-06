import { describe, expect, it } from 'vitest';
import { findCoveringWindow, type CapacityWindow } from './windows.js';

// 2026-08-03 is a Monday (UTC weekday 1).
const MONDAY_09 = new Date('2026-08-03T09:00:00Z');

const windows: CapacityWindow[] = [
  { weekday: 1, startMinute: 9 * 60, endMinute: 13 * 60, capacity: 3 },
  { weekday: 1, startMinute: 14 * 60, endMinute: 17 * 60, capacity: 1 },
  { weekday: 6, startMinute: 10 * 60, endMinute: 12 * 60, capacity: 8 },
];

describe('findCoveringWindow', () => {
  it('matches a booking fully inside a window', () => {
    expect(findCoveringWindow(windows, MONDAY_09, 60)?.capacity).toBe(3);
  });

  it('matches boundary bookings that exactly fill a window', () => {
    expect(findCoveringWindow(windows, MONDAY_09, 4 * 60)?.capacity).toBe(3);
  });

  it('picks the correct window among several on the same weekday', () => {
    const afternoon = new Date('2026-08-03T15:00:00Z');
    expect(findCoveringWindow(windows, afternoon, 60)?.capacity).toBe(1);
  });

  it('rejects a booking that spills past the window end', () => {
    const late = new Date('2026-08-03T12:30:00Z');
    expect(findCoveringWindow(windows, late, 60)).toBeNull();
  });

  it('rejects a booking in the gap between windows', () => {
    const gap = new Date('2026-08-03T13:15:00Z');
    expect(findCoveringWindow(windows, gap, 30)).toBeNull();
  });

  it('rejects weekdays with no window', () => {
    const tuesday = new Date('2026-08-04T09:00:00Z');
    expect(findCoveringWindow(windows, tuesday, 60)).toBeNull();
  });

  it('uses the UTC weekday, not local time', () => {
    // Saturday 10:00 UTC (weekday 6).
    const saturday = new Date('2026-08-08T10:00:00Z');
    expect(findCoveringWindow(windows, saturday, 120)?.capacity).toBe(8);
  });

  it('rejects bookings that would cross UTC midnight', () => {
    const nearMidnight = new Date('2026-08-03T23:30:00Z');
    const allDay: CapacityWindow[] = [
      { weekday: 1, startMinute: 0, endMinute: 1440, capacity: 5 },
      { weekday: 2, startMinute: 0, endMinute: 1440, capacity: 5 },
    ];
    expect(findCoveringWindow(allDay, nearMidnight, 60)).toBeNull();
  });
});
