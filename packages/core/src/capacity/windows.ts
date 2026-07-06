import type { Tier } from '../ports/scheduling.js';

// SERVICE providers (field/service businesses) skip tier classification:
// every booking is a flat-priced STANDARD request that must land inside an
// open window with remaining capacity.
export type ServiceTier = 'STANDARD';
export type RequestTier = Tier | ServiceTier;

// A weekly recurring availability window with its own concurrent-booking
// capacity. Same UTC conventions as professional_availability rows:
// weekday 0 = Sunday, minutes since UTC midnight.
export interface CapacityWindow {
  weekday: number;
  startMinute: number;
  endMinute: number;
  capacity: number;
}

// The window that fully contains [start, start + duration), or null.
// Windows never overlap (DB exclusion constraint), so at most one matches.
// Bookings crossing UTC midnight never fit a same-day window and are
// rejected here.
export function findCoveringWindow(
  windows: CapacityWindow[],
  start: Date,
  durationMinutes: number,
): CapacityWindow | null {
  const weekday = start.getUTCDay();
  const startMinute = start.getUTCHours() * 60 + start.getUTCMinutes();
  const endMinute = startMinute + durationMinutes;
  if (endMinute > 1440) return null;
  return (
    windows.find(
      (w) => w.weekday === weekday && startMinute >= w.startMinute && endMinute <= w.endMinute,
    ) ?? null
  );
}
