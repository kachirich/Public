import type { AvailabilitySlot, CreateBookingInput, SchedulingPort } from '../ports/scheduling.js';

// In-memory SchedulingPort. Tests configure availability/working days and
// can mark slots as taken to exercise the re-validate-at-acceptance path.
export class FakeSchedulingPort implements SchedulingPort {
  availability: AvailabilitySlot[] = [];
  workingDays = new Set<number>([1, 2, 3, 4, 5]); // getUTCDay() values
  readonly bookings: (CreateBookingInput & { bookingId: number })[] = [];
  readonly cancelled: { bookingId: number; reason: string }[] = [];
  /** Slot starts (ms) that will reject with a conflict, e.g. taken meanwhile. */
  readonly takenSlots = new Set<number>();
  private nextBookingId = 1000;

  async getAvailability(_userId: number, from: Date, to: Date): Promise<AvailabilitySlot[]> {
    return this.availability.filter((s) => s.end > from && s.start < to);
  }

  async isWorkingDay(_userId: number, date: Date): Promise<boolean> {
    return this.workingDays.has(date.getUTCDay());
  }

  async createBooking(input: CreateBookingInput): Promise<{ bookingId: number }> {
    if (this.takenSlots.has(input.start.getTime())) {
      throw new SlotTakenError(input.start);
    }
    const bookingId = this.nextBookingId++;
    this.bookings.push({ ...input, bookingId });
    return { bookingId };
  }

  async cancelBooking(bookingId: number, reason: string): Promise<void> {
    this.cancelled.push({ bookingId, reason });
  }
}

export class SlotTakenError extends Error {
  constructor(readonly slotStart: Date) {
    super(`Slot no longer available: ${slotStart.toISOString()}`);
    this.name = 'SlotTakenError';
  }
}
