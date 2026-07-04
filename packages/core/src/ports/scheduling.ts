export type Tier = 'IN_HOURS' | 'OFF_DUTY' | 'OFF_DAY' | 'PREMIUM_INTERRUPT';

export interface AvailabilitySlot {
  start: Date;
  end: Date;
}

export interface CreateBookingInput {
  calcomUserId: number;
  calcomEventType: number;
  start: Date;
  durationMinutes: number;
  /** Off-availability tiers force-book past availability checks. */
  force: boolean;
  metadata?: Record<string, string>;
}

export interface SchedulingPort {
  getAvailability(calcomUserId: number, from: Date, to: Date): Promise<AvailabilitySlot[]>;
  isWorkingDay(calcomUserId: number, date: Date): Promise<boolean>;
  createBooking(input: CreateBookingInput): Promise<{ bookingId: number }>;
  cancelBooking(bookingId: number, reason: string): Promise<void>;
}
