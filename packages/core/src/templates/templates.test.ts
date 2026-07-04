import { describe, expect, it } from 'vitest';
import { renderTemplate, TEMPLATES } from './index.js';

// One representative payload per template. Snapshots pin the exact wording;
// the rule tests below assert the invariants that must survive any rewording.
const SAMPLE_PAYLOADS: Record<string, Record<string, unknown>> = {
  REQUEST_CARD: {
    refCode: 'R4X2',
    sessionStart: '2026-08-01T10:00:00Z',
    durationMinutes: 60,
    tier: 'OFF_DUTY',
    payoutNet: '850.00',
    currency: 'KES',
    expiresAt: '2026-07-31T14:00:00Z',
    brief: 'Second opinion on an MRI result',
  },
  CARD_REMINDER: {
    refCode: 'R4X2',
    sessionStart: '2026-08-01T10:00:00Z',
    payoutNet: '850.00',
    currency: 'KES',
    expiresAt: '2026-07-31T14:00:00Z',
  },
  ACCEPTED_PROFESSIONAL: {
    refCode: 'R4X2',
    sessionStart: '2026-08-01T10:00:00Z',
    payoutNet: '850.00',
    currency: 'KES',
  },
  ACCEPTED_CLIENT: {
    refCode: 'R4X2',
    sessionStart: '2026-08-01T10:00:00Z',
    priceGross: '1000.00',
    currency: 'KES',
  },
  DECLINED_CLIENT: { refCode: 'R4X2' },
  EXPIRED_CLIENT: { refCode: 'R4X2' },
  COUNTER_PROMPT: { refCode: 'R4X2' },
  COUNTER_CONFIRM_ECHO: {
    refCode: 'R4X2',
    slots: [
      { sessionStart: '2026-08-02T14:00:00Z', durationMinutes: 60 },
      { sessionStart: '2026-08-03T07:30:00Z', durationMinutes: 60 },
    ],
  },
  COUNTER_SENT_CLIENT: { refCode: 'R4X2' },
  PARTIAL_REFUND_CLIENT: { refCode: 'R4X2', amount: '250.00', currency: 'KES' },
  ROOM_WELCOME: {
    refCode: 'R4X2',
    professionalName: 'Dr Achieng',
    clientName: 'Brian',
    sessionStart: '2026-08-01T10:00:00Z',
    durationMinutes: 60,
  },
  NO_SHOW_NUDGE: { refCode: 'R4X2', minutesLate: 5 },
  NO_SHOW_CLIENT_REFUND: { refCode: 'R4X2', amount: '1000.00', currency: 'KES' },
  SESSION_END_WARNING: { refCode: 'R4X2', minutesLeft: 10 },
  PAYOUT_CONFIRMED: { refCode: 'R4X2', payoutNet: '850.00', currency: 'KES' },
  REBOOK_PROMPT: { refCode: 'R4X2' },
  WHICH_REQUEST: { refCodes: ['R4X2', 'R7YQ'] },
  REPROMPT: { refCode: 'R4X2', hint: 'Reply 1 to accept or 2 to decline.' },
  STATUS_SUMMARY: { refCode: 'R4X2', state: 'REFUNDED', moneyLine: 'Your payment was fully refunded.' },
  VERIFICATION_OTP: { code: '482913' },
  VERIFICATION_APPROVED: { displayName: 'Dr Achieng' },
  VERIFICATION_REJECTED: { registry: 'KMPDC', attemptsLeft: 2 },
  VERIFICATION_IN_REVIEW: {},
};

const PROFESSIONAL_FACING = [
  'REQUEST_CARD',
  'CARD_REMINDER',
  'ACCEPTED_PROFESSIONAL',
  'COUNTER_PROMPT',
  'COUNTER_CONFIRM_ECHO',
  'NO_SHOW_NUDGE',
  'PAYOUT_CONFIRMED',
];

describe('templates', () => {
  it('every spec template key exists and none are extra', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(Object.keys(SAMPLE_PAYLOADS).sort());
  });

  for (const [key, payload] of Object.entries(SAMPLE_PAYLOADS)) {
    it(`${key} snapshot`, () => {
      expect(renderTemplate(key, payload)).toMatchSnapshot();
    });
  }

  it('every professional-facing template includes the #REF code', () => {
    for (const key of PROFESSIONAL_FACING) {
      expect(renderTemplate(key, SAMPLE_PAYLOADS[key]!), key).toContain('#R4X2');
    }
  });

  it('professional-facing money is NET, never the gross amount', () => {
    for (const key of ['REQUEST_CARD', 'CARD_REMINDER', 'ACCEPTED_PROFESSIONAL', 'PAYOUT_CONFIRMED']) {
      const text = renderTemplate(key, SAMPLE_PAYLOADS[key]!);
      expect(text, key).toContain('850.00');
      expect(text, key).not.toContain('1000.00');
    }
  });

  it('client-facing money is GROSS, never the net payout', () => {
    const accepted = renderTemplate('ACCEPTED_CLIENT', SAMPLE_PAYLOADS.ACCEPTED_CLIENT!);
    expect(accepted).toContain('1000.00');
    expect(accepted).not.toContain('850.00');

    const noShow = renderTemplate('NO_SHOW_CLIENT_REFUND', SAMPLE_PAYLOADS.NO_SHOW_CLIENT_REFUND!);
    expect(noShow).toContain('1000.00');
  });

  it('pre-room professional-facing payload types carry no client contact fields', () => {
    // Compile-time rule made observable: rendering with injected client
    // contact details must not leak them into the text, because no
    // pre-room professional template reads any such field.
    const contact = { clientPhone: '+254711222333', clientEmail: 'leak@example.com', clientName: 'Leaky' };
    for (const key of PROFESSIONAL_FACING) {
      const text = renderTemplate(key, { ...SAMPLE_PAYLOADS[key]!, ...contact });
      expect(text, key).not.toContain('+254711222333');
      expect(text, key).not.toContain('leak@example.com');
      expect(text, key).not.toContain('Leaky');
    }
  });

  it('unknown template keys throw', () => {
    expect(() => renderTemplate('NOT_A_TEMPLATE', {})).toThrow('Unknown template key');
  });
});
