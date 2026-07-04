import type { MessageChannel } from '../ports/messaging.js';
import type { RequestState } from './transitions.js';

// Snapshot of the request row (plus joined contact info) as read inside the
// transition's FOR UPDATE query. Money columns arrive as strings from pg
// (numeric); they are never parsed to floats.
export interface RequestSnapshot {
  id: string;
  refCode: string;
  clientId: string;
  professionalId: string;
  tier: string;
  state: RequestState;
  sessionStart: Date;
  durationMinutes: number;
  brief: string;
  currency: string;
  priceGross: string;
  platformFee: string;
  payoutNet: string;
  cardExpiresAt: Date | null;
  version: number;
  professionalWhatsapp: string;
  professionalPreferredChannel: MessageChannel;
  clientPhone: string | null;
  clientEmail: string | null;
}

export interface TransitionMetadata {
  /** Provider transaction/refund reference for ledger rows written by this transition. */
  providerRef?: string;
  /** Set when an accepted counter-offer landed in a cheaper tier: refund of the difference. */
  partialRefundAmount?: string;
  [key: string]: unknown;
}

export interface LedgerEffect {
  entryType: 'HOLD' | 'COMMIT' | 'RELEASE' | 'REFUND' | 'PARTIAL_REFUND' | 'PLATFORM_FEE';
  amount: string;
  providerRef: string | null;
}

export interface NotificationEffect {
  channel: MessageChannel;
  recipient: string;
  templateKey: string;
  payload: Record<string, unknown>;
}

export interface TimerEffect {
  jobType: string;
  runAt: Date;
}

export interface TransitionEffects {
  ledger: LedgerEffect[];
  notifications: NotificationEffect[];
  timers: TimerEffect[];
}

function minutes(n: number): number {
  return n * 60_000;
}

function clientChannel(req: RequestSnapshot): { channel: MessageChannel; recipient: string } {
  // Clients live in the web UI; email is the default notification channel,
  // WhatsApp the fallback when no email is on file.
  if (req.clientEmail) return { channel: 'EMAIL', recipient: req.clientEmail };
  if (req.clientPhone) return { channel: 'WHATSAPP', recipient: req.clientPhone };
  throw new Error(`Client ${req.clientId} has no contact channel`);
}

function toProfessional(req: RequestSnapshot, templateKey: string, payload: Record<string, unknown>): NotificationEffect {
  return {
    channel: req.professionalPreferredChannel,
    recipient: req.professionalWhatsapp,
    templateKey,
    payload: { refCode: req.refCode, ...payload },
  };
}

function toClient(req: RequestSnapshot, templateKey: string, payload: Record<string, unknown>): NotificationEffect {
  return { ...clientChannel(req), templateKey, payload };
}

// What each arrival state means for money, messages, and timers.
// Professional-facing payloads carry NET amounts, client-facing carry GROSS
// (rule enforced again in the templates themselves, phase 4).
export function resolveEffects(req: RequestSnapshot, toState: RequestState, meta: TransitionMetadata, now: Date): TransitionEffects {
  const none: TransitionEffects = { ledger: [], notifications: [], timers: [] };
  const providerRef = meta.providerRef ?? null;

  switch (toState) {
    case 'REQUESTED': // initial state only; no transition arrives here
    case 'PENDING_PAYMENT':
    case 'CANCELLED':
    case 'IN_SESSION':
      return none;

    case 'HELD': {
      if (!req.cardExpiresAt) throw new Error(`Request ${req.id} entering HELD without card_expires_at`);
      const expiry = req.cardExpiresAt.getTime();
      return {
        ledger: [{ entryType: 'HOLD', amount: req.priceGross, providerRef }],
        notifications: [
          toProfessional(req, 'REQUEST_CARD', {
            sessionStart: req.sessionStart.toISOString(),
            durationMinutes: req.durationMinutes,
            tier: req.tier,
            payoutNet: req.payoutNet,
            currency: req.currency,
            expiresAt: req.cardExpiresAt.toISOString(),
            brief: req.brief,
          }),
        ],
        timers: [
          { jobType: 'CARD_REMINDER', runAt: new Date(now.getTime() + (expiry - now.getTime()) / 2) },
          { jobType: 'CARD_EXPIRY', runAt: req.cardExpiresAt },
        ],
      };
    }

    case 'COUNTER_OFFERED':
      return {
        ledger: [],
        notifications: [toClient(req, 'COUNTER_SENT_CLIENT', { refCode: req.refCode })],
        timers: [{ jobType: 'COUNTER_EXPIRY', runAt: new Date(now.getTime() + minutes(12 * 60)) }],
      };

    case 'ACCEPTED': {
      const start = req.sessionStart.getTime();
      const end = start + minutes(req.durationMinutes);
      const ledger: LedgerEffect[] = [{ entryType: 'COMMIT', amount: req.priceGross, providerRef }];
      const notifications = [
        toProfessional(req, 'ACCEPTED_PROFESSIONAL', {
          sessionStart: req.sessionStart.toISOString(),
          payoutNet: req.payoutNet,
          currency: req.currency,
        }),
        toClient(req, 'ACCEPTED_CLIENT', {
          refCode: req.refCode,
          sessionStart: req.sessionStart.toISOString(),
          priceGross: req.priceGross,
          currency: req.currency,
        }),
      ];
      if (meta.partialRefundAmount) {
        ledger.push({ entryType: 'PARTIAL_REFUND', amount: meta.partialRefundAmount, providerRef });
        notifications.push(
          toClient(req, 'PARTIAL_REFUND_CLIENT', {
            refCode: req.refCode,
            amount: meta.partialRefundAmount,
            currency: req.currency,
          }),
        );
      }
      return {
        ledger,
        notifications,
        timers: [
          { jobType: 'ROOM_OPEN', runAt: new Date(start - minutes(15)) },
          { jobType: 'NO_SHOW_CHECK', runAt: new Date(start + minutes(5)) },
          { jobType: 'NO_SHOW_CHECK', runAt: new Date(start + minutes(15)) },
          { jobType: 'SESSION_END_WARNING', runAt: new Date(end - minutes(10)) },
          { jobType: 'SESSION_END', runAt: new Date(end) },
          { jobType: 'ROOM_DISSOLVE', runAt: new Date(end + minutes(30)) },
        ],
      };
    }

    case 'COMPLETED':
      return {
        ledger: [
          { entryType: 'RELEASE', amount: req.payoutNet, providerRef },
          { entryType: 'PLATFORM_FEE', amount: req.platformFee, providerRef },
        ],
        notifications: [
          toProfessional(req, 'PAYOUT_CONFIRMED', { payoutNet: req.payoutNet, currency: req.currency }),
          toClient(req, 'REBOOK_PROMPT', { refCode: req.refCode }),
        ],
        timers: [],
      };

    case 'NO_SHOW_CLIENT':
      // Client absent: professional is paid in full, no refund.
      return {
        ledger: [
          { entryType: 'RELEASE', amount: req.payoutNet, providerRef },
          { entryType: 'PLATFORM_FEE', amount: req.platformFee, providerRef },
        ],
        notifications: [toProfessional(req, 'PAYOUT_CONFIRMED', { payoutNet: req.payoutNet, currency: req.currency })],
        timers: [],
      };

    // The three refund-pending states schedule an immediate REFUND_EXECUTE
    // job: the poller calls PaymentsPort.refund and, on provider
    // confirmation, transitions to REFUNDED (which writes the ledger row).
    case 'DECLINED':
      return {
        ledger: [],
        notifications: [toClient(req, 'DECLINED_CLIENT', { refCode: req.refCode })],
        timers: [{ jobType: 'REFUND_EXECUTE', runAt: now }],
      };

    case 'EXPIRED':
      return {
        ledger: [],
        notifications: [toClient(req, 'EXPIRED_CLIENT', { refCode: req.refCode })],
        timers: [{ jobType: 'REFUND_EXECUTE', runAt: now }],
      };

    case 'NO_SHOW_PROFESSIONAL':
      return {
        ledger: [],
        notifications: [
          toClient(req, 'NO_SHOW_CLIENT_REFUND', {
            refCode: req.refCode,
            amount: req.priceGross,
            currency: req.currency,
          }),
        ],
        timers: [{ jobType: 'REFUND_EXECUTE', runAt: now }],
      };

    case 'REFUNDED':
      // Refund confirmed by the payment provider; the DECLINED/EXPIRED/
      // NO_SHOW_PROFESSIONAL transition already told the client it's coming.
      return {
        ledger: [{ entryType: 'REFUND', amount: req.priceGross, providerRef }],
        notifications: [],
        timers: [],
      };

    default: {
      const exhaustive: never = toState;
      throw new Error(`Unhandled state: ${exhaustive}`);
    }
  }
}
