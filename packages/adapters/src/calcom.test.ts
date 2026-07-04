import { describe, expect, it } from 'vitest';
import { CalcomAdapter } from './calcom.js';
import { fakeFetch } from './test-helpers.js';

const CONFIG = { baseUrl: 'https://cal.example.com/api/v1', apiKey: 'cal_key' };

// Mon 2026-07-06 .. covering a work week. Nairobi is UTC+3 year-round (no
// DST), so 09:00–17:00 local = 06:00–14:00 UTC.
const NAIROBI_HOURS = {
  timeZone: 'Africa/Nairobi',
  workingHours: [{ days: [1, 2, 3, 4, 5], startTime: 9 * 60, endTime: 17 * 60 }],
  busy: [] as { start: string; end: string }[],
};

describe('CalcomAdapter.getAvailability', () => {
  it('turns working hours into free slots in the professional timezone', async () => {
    const { fetchFn, calls } = fakeFetch([{ body: NAIROBI_HOURS }]);
    const adapter = new CalcomAdapter(CONFIG, fetchFn);

    const from = new Date('2026-07-06T00:00:00Z'); // Monday
    const to = new Date('2026-07-07T00:00:00Z');
    const slots = await adapter.getAvailability(7, from, to);

    expect(calls[0]!.url).toContain('/availability?');
    expect(calls[0]!.url).toContain('userId=7');
    expect(calls[0]!.url).toContain('apiKey=cal_key');

    expect(slots).toEqual([
      { start: new Date('2026-07-06T06:00:00Z'), end: new Date('2026-07-06T14:00:00Z') },
    ]);
  });

  it('subtracts busy intervals from working windows', async () => {
    const { fetchFn } = fakeFetch([
      {
        body: {
          ...NAIROBI_HOURS,
          busy: [
            { start: '2026-07-06T08:00:00Z', end: '2026-07-06T09:00:00Z' },
            { start: '2026-07-06T13:30:00Z', end: '2026-07-06T15:00:00Z' }, // overlaps window end
          ],
        },
      },
    ]);
    const adapter = new CalcomAdapter(CONFIG, fetchFn);

    const slots = await adapter.getAvailability(7, new Date('2026-07-06T00:00:00Z'), new Date('2026-07-07T00:00:00Z'));

    expect(slots).toEqual([
      { start: new Date('2026-07-06T06:00:00Z'), end: new Date('2026-07-06T08:00:00Z') },
      { start: new Date('2026-07-06T09:00:00Z'), end: new Date('2026-07-06T13:30:00Z') },
    ]);
  });

  it('yields nothing on a non-working day', async () => {
    const { fetchFn } = fakeFetch([{ body: NAIROBI_HOURS }]);
    const adapter = new CalcomAdapter(CONFIG, fetchFn);
    // Sunday 2026-07-05.
    const slots = await adapter.getAvailability(7, new Date('2026-07-05T00:00:00Z'), new Date('2026-07-06T00:00:00Z'));
    expect(slots).toEqual([]);
  });
});

describe('CalcomAdapter.isWorkingDay', () => {
  it('true on a weekday, false on the weekend (professional timezone)', async () => {
    const monday = new CalcomAdapter(CONFIG, fakeFetch([{ body: NAIROBI_HOURS }]).fetchFn);
    expect(await monday.isWorkingDay(7, new Date('2026-07-06T10:00:00Z'))).toBe(true);

    const sunday = new CalcomAdapter(CONFIG, fakeFetch([{ body: NAIROBI_HOURS }]).fetchFn);
    expect(await sunday.isWorkingDay(7, new Date('2026-07-05T10:00:00Z'))).toBe(false);
  });
});

describe('CalcomAdapter bookings', () => {
  it('createBooking posts start/end and tags force-booked requests', async () => {
    const { fetchFn, calls } = fakeFetch([{ body: { id: 991 } }]);
    const adapter = new CalcomAdapter(CONFIG, fetchFn);

    const result = await adapter.createBooking({
      calcomUserId: 7,
      calcomEventType: 21,
      start: new Date('2026-07-06T18:00:00Z'),
      durationMinutes: 45,
      force: true,
      metadata: { requestRef: 'R4X2' },
    });

    expect(result).toEqual({ bookingId: 991 });
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toContain('/bookings?');
    expect(calls[0]!.body).toMatchObject({
      eventTypeId: 21,
      userId: 7,
      start: '2026-07-06T18:00:00.000Z',
      end: '2026-07-06T18:45:00.000Z',
      metadata: { requestRef: 'R4X2', forceBooked: 'true' },
    });
  });

  it('cancelBooking hits the cancel endpoint with the reason', async () => {
    const { fetchFn, calls } = fakeFetch([{ body: {} }]);
    const adapter = new CalcomAdapter(CONFIG, fetchFn);

    await adapter.cancelBooking(991, 'NO_SHOW_PROFESSIONAL');

    expect(calls[0]!.method).toBe('DELETE');
    expect(calls[0]!.url).toContain('/bookings/991/cancel?');
    expect(calls[0]!.url).toContain('cancellationReason=NO_SHOW_PROFESSIONAL');
  });
});
