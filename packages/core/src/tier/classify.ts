import type { AvailabilitySlot, Tier } from '../ports/scheduling.js';

export interface ClassifyInput {
  requestedStart: Date;
  durationMinutes: number;
  now: Date;
  /** Free windows from SchedulingPort.getAvailability covering the requested range. */
  availability: AvailabilitySlot[];
  /** Whether the requested date is a working day for the professional. */
  isWorkingDay: boolean;
}

const PREMIUM_INTERRUPT_WINDOW_MS = 60 * 60_000;

// Tier rules, in precedence order:
//   start within 60 minutes  -> PREMIUM_INTERRUPT (overrides everything)
//   inside an available slot -> IN_HOURS
//   working day, outside     -> OFF_DUTY
//   non-working day          -> OFF_DAY
export function classifyTier(input: ClassifyInput): Tier {
  const start = input.requestedStart.getTime();
  const end = start + input.durationMinutes * 60_000;

  if (start - input.now.getTime() <= PREMIUM_INTERRUPT_WINDOW_MS) {
    return 'PREMIUM_INTERRUPT';
  }

  const insideAvailability = input.availability.some(
    (slot) => start >= slot.start.getTime() && end <= slot.end.getTime(),
  );
  if (insideAvailability) return 'IN_HOURS';

  return input.isWorkingDay ? 'OFF_DUTY' : 'OFF_DAY';
}

// Card acceptance deadline scales with how disruptive the request is.
export const CARD_EXPIRY_MINUTES: Readonly<Record<Tier, number>> = {
  PREMIUM_INTERRUPT: 15,
  OFF_DUTY: 4 * 60,
  OFF_DAY: 12 * 60,
  IN_HOURS: 12 * 60,
};

export function cardExpiresAt(tier: Tier, now: Date): Date {
  return new Date(now.getTime() + CARD_EXPIRY_MINUTES[tier] * 60_000);
}
