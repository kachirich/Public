import type { AvailabilitySlot, CreateBookingInput, PaymentsPort, SchedulingPort } from '@marketplace/core';
import type { InitPaymentInput } from '@marketplace/core';
import type pg from 'pg';

// Development-only provider stubs, wired in index.ts when NODE_ENV is
// development and the real provider env vars are absent. They make the
// full booking flow drivable locally, and "paying" bounces through
// GET /dev/confirm-payment/:id which fires the same confirm path a real
// Paystack webhook would.

// Weekly hours a professional set through the portal (with consent) drive
// tier classification, exactly as Cal.com availability would in production.
// Professionals who have not set hours yet fall back to Mon–Fri 09:00–17:00
// UTC so the marketplace stays browsable.
const FALLBACK_HOURS = { startMinute: 9 * 60, endMinute: 17 * 60, weekdays: [1, 2, 3, 4, 5] };

export class DevSchedulingStub implements SchedulingPort {
  private nextBookingId = 90_000;

  constructor(private readonly pool: pg.Pool) {}

  private async weeklyHours(calcomUserId: number): Promise<Map<number, { startMinute: number; endMinute: number }>> {
    const { rows } = await this.pool.query(
      `SELECT a.weekday, a.start_minute, a.end_minute
       FROM professional_availability a
       JOIN professionals p ON p.id = a.professional_id
       WHERE p.calcom_user_id = $1 AND p.availability_consent_at IS NOT NULL`,
      [calcomUserId],
    );
    const map = new Map<number, { startMinute: number; endMinute: number }>();
    for (const r of rows) map.set(r.weekday, { startMinute: r.start_minute, endMinute: r.end_minute });
    if (map.size === 0) {
      for (const d of FALLBACK_HOURS.weekdays) {
        map.set(d, { startMinute: FALLBACK_HOURS.startMinute, endMinute: FALLBACK_HOURS.endMinute });
      }
    }
    return map;
  }

  async getAvailability(calcomUserId: number, from: Date, to: Date): Promise<AvailabilitySlot[]> {
    const hours = await this.weeklyHours(calcomUserId);
    const slots: AvailabilitySlot[] = [];
    const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    while (day < to) {
      const window = hours.get(day.getUTCDay());
      if (window) {
        slots.push({
          start: new Date(day.getTime() + window.startMinute * 60_000),
          end: new Date(day.getTime() + window.endMinute * 60_000),
        });
      }
      day.setUTCDate(day.getUTCDate() + 1);
    }
    return slots.filter((s) => s.end > from && s.start < to);
  }

  async isWorkingDay(calcomUserId: number, date: Date): Promise<boolean> {
    const hours = await this.weeklyHours(calcomUserId);
    return hours.has(date.getUTCDay());
  }

  async createBooking(_input: CreateBookingInput): Promise<{ bookingId: number }> {
    return { bookingId: this.nextBookingId++ };
  }

  async cancelBooking(): Promise<void> {}
}

export class DevPaymentsStub implements PaymentsPort {
  constructor(private readonly orchestratorBaseUrl: string) {}

  async initPayment(input: InitPaymentInput): Promise<{ authorizationUrl: string; providerRef: string }> {
    const providerRef = `dev-pay-${input.requestId}`;
    return {
      authorizationUrl: `${this.orchestratorBaseUrl}/dev/confirm-payment/${input.requestId}`,
      providerRef,
    };
  }

  async refund(providerRef: string): Promise<{ refundRef: string }> {
    return { refundRef: `dev-refund-${providerRef}` };
  }

  verifyWebhookSignature(): boolean {
    return false; // real webhooks are never valid against the stub
  }
}
