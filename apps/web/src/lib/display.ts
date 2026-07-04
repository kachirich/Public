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
