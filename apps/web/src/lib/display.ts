// Pure display helpers — unit-testable without React.

export const TERMINAL_STATES = new Set(['COMPLETED', 'REFUNDED', 'NO_SHOW_CLIENT', 'CANCELLED']);

export const STATE_COPY: Record<string, { title: string; detail: string }> = {
  REQUESTED: {
    title: 'Quote ready',
    detail: 'Review the price below and pay to send your request to the professional.',
  },
  PENDING_PAYMENT: {
    title: 'Waiting for your payment',
    detail: 'Complete the payment in the checkout window. This page updates automatically.',
  },
  HELD: {
    title: 'Waiting for the professional',
    detail: 'Your payment is safely in escrow and the professional has been notified on WhatsApp.',
  },
  COUNTER_OFFERED: {
    title: 'New times proposed',
    detail: 'The requested time did not work, but the professional suggested alternatives below.',
  },
  ACCEPTED: {
    title: 'Session confirmed',
    detail: 'A WhatsApp consult room opens 15 minutes before the start.',
  },
  IN_SESSION: {
    title: 'Session in progress',
    detail: 'Your consult room is open on WhatsApp.',
  },
  COMPLETED: {
    title: 'Session complete',
    detail: 'Thanks for booking! You can rebook the same professional any time.',
  },
  DECLINED: {
    title: 'Professional declined',
    detail: 'Your full payment is being refunded — it usually lands within 2 business days.',
  },
  EXPIRED: {
    title: 'No response in time',
    detail: 'Your full payment is being refunded — it usually lands within 2 business days.',
  },
  NO_SHOW_PROFESSIONAL: {
    title: 'Professional did not show up',
    detail: 'We are sorry. Your full payment is being refunded.',
  },
  NO_SHOW_CLIENT: {
    title: 'Marked as no-show',
    detail: 'You did not join the session, so the professional was paid in full.',
  },
  REFUNDED: {
    title: 'Refunded',
    detail: 'Your payment has been fully refunded.',
  },
  CANCELLED: {
    title: 'Cancelled',
    detail: 'This request was cancelled before any payment was taken.',
  },
};

export const CATEGORY_COPY: Record<string, { label: string; plural: string; institution: string }> = {
  DOCTOR: { label: 'Doctor', plural: 'Doctors', institution: 'Hospital' },
  LECTURER: { label: 'Lecturer', plural: 'Lecturers', institution: 'University' },
  LAWYER: { label: 'Lawyer', plural: 'Lawyers', institution: 'Firm' },
  ACCOUNTANT: { label: 'Accountant', plural: 'Accountants', institution: 'Firm' },
  ENGINEER: { label: 'Engineer', plural: 'Engineers', institution: 'Company' },
  THERAPIST: { label: 'Therapist', plural: 'Therapists', institution: 'Practice' },
};

export function categoryLabel(category: string): string {
  return CATEGORY_COPY[category]?.label ?? category;
}

export function initials(name: string): string {
  return name
    .replace(/^(Dr|Prof|Eng|Adv)\.?\s+/i, '')
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// --- calendar export (shown once a session is confirmed) ---

interface CalendarEvent {
  refCode: string;
  professionalName: string;
  sessionStart: string; // ISO
  durationMinutes: number;
  brief?: string;
}

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function googleCalendarUrl(ev: CalendarEvent): string {
  const start = new Date(ev.sessionStart);
  const end = new Date(start.getTime() + ev.durationMinutes * 60_000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Session with ${ev.professionalName} (#${ev.refCode})`,
    dates: `${icsStamp(start)}/${icsStamp(end)}`,
    details: 'Booked via Professional Access. The WhatsApp consult room opens 15 minutes before the start.',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildIcs(ev: CalendarEvent): string {
  const start = new Date(ev.sessionStart);
  const end = new Date(start.getTime() + ev.durationMinutes * 60_000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Professional Access//Booking//EN',
    'BEGIN:VEVENT',
    `UID:${ev.refCode}@professional-access`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:Session with ${ev.professionalName} (#${ev.refCode})`,
    'DESCRIPTION:Booked via Professional Access. The WhatsApp consult room opens 15 minutes before the start.',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function formatMoney(amount: string, currency: string): string {
  return `${currency.trim()} ${amount}`;
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-KE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Nairobi',
  });
}
