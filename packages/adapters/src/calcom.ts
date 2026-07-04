import type { AvailabilitySlot, CreateBookingInput, SchedulingPort } from '@marketplace/core';
import { expectOk, type FetchLike } from './http.js';

export interface CalcomConfig {
  /** Self-hosted Cal.com API v1 root, e.g. https://cal.example.com/api/v1 */
  baseUrl: string;
  apiKey: string;
}

interface CalcomAvailabilityResponse {
  busy: { start: string; end: string }[];
  timeZone: string;
  workingHours: { days: number[]; startTime: number; endTime: number }[]; // minutes from local midnight
  dateOverrides?: { date: string; startTime: number; endTime: number }[];
}

// Cal.com's /availability returns working hours (in the professional's
// timezone) plus busy intervals; free slots = working windows minus busy.
export class CalcomAdapter implements SchedulingPort {
  constructor(
    private readonly config: CalcomConfig,
    private readonly fetchFn: FetchLike = globalThis.fetch,
  ) {}

  private url(path: string, params: Record<string, string>): string {
    const q = new URLSearchParams({ ...params, apiKey: this.config.apiKey });
    return `${this.config.baseUrl}${path}?${q}`;
  }

  private async fetchAvailability(userId: number, from: Date, to: Date): Promise<CalcomAvailabilityResponse> {
    const res = await this.fetchFn(
      this.url('/availability', {
        userId: String(userId),
        dateFrom: from.toISOString(),
        dateTo: to.toISOString(),
      }),
    );
    return (await expectOk('calcom', res)) as CalcomAvailabilityResponse;
  }

  async getAvailability(userId: number, from: Date, to: Date): Promise<AvailabilitySlot[]> {
    const data = await this.fetchAvailability(userId, from, to);
    const busy = data.busy.map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }));

    const windows: { start: number; end: number }[] = [];
    // Walk each calendar day of the range in the professional's timezone.
    for (let t = startOfDayInTz(from, data.timeZone); t < to.getTime(); t += 24 * 3600_000) {
      const dayStart = startOfDayInTz(new Date(t), data.timeZone);
      const weekday = weekdayInTz(new Date(dayStart), data.timeZone);
      for (const wh of data.workingHours) {
        if (!wh.days.includes(weekday)) continue;
        windows.push({ start: dayStart + wh.startTime * 60_000, end: dayStart + wh.endTime * 60_000 });
      }
    }

    const free: AvailabilitySlot[] = [];
    for (const w of windows) {
      let segments = [{ start: Math.max(w.start, from.getTime()), end: Math.min(w.end, to.getTime()) }];
      for (const b of busy) {
        segments = segments.flatMap((s) => {
          if (b.end <= s.start || b.start >= s.end) return [s];
          const out = [];
          if (b.start > s.start) out.push({ start: s.start, end: b.start });
          if (b.end < s.end) out.push({ start: b.end, end: s.end });
          return out;
        });
      }
      for (const s of segments) {
        if (s.end > s.start) free.push({ start: new Date(s.start), end: new Date(s.end) });
      }
    }
    return free.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  async isWorkingDay(userId: number, date: Date): Promise<boolean> {
    const dayEnd = new Date(date.getTime() + 24 * 3600_000);
    const data = await this.fetchAvailability(userId, date, dayEnd);
    const weekday = weekdayInTz(date, data.timeZone);
    return data.workingHours.some((wh) => wh.days.includes(weekday));
  }

  async createBooking(input: CreateBookingInput): Promise<{ bookingId: number }> {
    const end = new Date(input.start.getTime() + input.durationMinutes * 60_000);
    const res = await this.fetchFn(this.url('/bookings', {}), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventTypeId: input.calcomEventType,
        userId: input.calcomUserId,
        start: input.start.toISOString(),
        end: end.toISOString(),
        timeZone: 'UTC',
        language: 'en',
        // Off-availability tiers book past availability; self-hosted
        // Cal.com honours admin API bookings, and we tag them for audit.
        metadata: { ...input.metadata, forceBooked: String(input.force) },
        responses: input.metadata ?? {},
      }),
    });
    const body = (await expectOk('calcom', res)) as { id: number };
    return { bookingId: body.id };
  }

  async cancelBooking(bookingId: number, reason: string): Promise<void> {
    const res = await this.fetchFn(this.url(`/bookings/${bookingId}/cancel`, { cancellationReason: reason }), {
      method: 'DELETE',
    });
    await expectOk('calcom', res);
  }
}

// Both helpers lean on Intl so DST in the professional's timezone is
// handled by the runtime, not by us.
function weekdayInTz(date: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

function startOfDayInTz(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  // Local wall-clock time of `date`, then subtract it to land on local midnight.
  const sinceMidnightMs = ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000 + date.getMilliseconds();
  return date.getTime() - sinceMidnightMs;
}
