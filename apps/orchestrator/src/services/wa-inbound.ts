import {
  classifyTier,
  parseCounterSlots,
  parseReply,
  transition,
  type RequestState,
  type Tier,
} from '@marketplace/core';
import type { AppDeps } from '../deps.js';
import { acceptRequest } from './accept.js';
import { computeBreakdown, fromCents, priceFor, toCents } from './pricing.js';

export interface InboundMessage {
  waMessageId: string;
  fromE164: string;
  body: string;
}

export type InboundOutcome =
  | 'DUPLICATE'
  | 'UNKNOWN_SENDER'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'COUNTER_STARTED'
  | 'COUNTER_ECHOED'
  | 'COUNTER_SENT'
  | 'REPROMPTED'
  | 'WHICH_REQUEST'
  | 'STATUS_REPLIED'
  | 'IGNORED';

// Intent markers stored on inbound_messages.parsed_intent; the counter-offer
// flow's stage is derived from the professional's previous marker, so the
// flow survives restarts without extra tables.
const COUNTER_COLLECTING = 'COUNTER_INIT';
const COUNTER_AWAITING_CONFIRM = 'COUNTER_SLOTS';

const OPEN_STATES: RequestState[] = ['HELD'];

export async function handleWaInbound(deps: AppDeps, msg: InboundMessage): Promise<InboundOutcome> {
  const { rows: profRows } = await deps.pool.query(
    `SELECT id, whatsapp_e164, preferred_channel, fee_percent, calcom_user_id, provider_type
     FROM professionals WHERE whatsapp_e164 = $1`,
    [msg.fromE164],
  );
  const professional = profRows[0];

  // Dedup on wa_message_id happens before anything can act twice.
  const { rows: inserted } = await deps.pool.query(
    `INSERT INTO inbound_messages (professional_id, wa_message_id, body)
     VALUES ($1, $2, $3) ON CONFLICT (wa_message_id) DO NOTHING RETURNING id`,
    [professional?.id ?? null, msg.waMessageId, msg.body],
  );
  if (inserted.length === 0) return 'DUPLICATE';
  const inboundId: string = inserted[0].id;
  if (!professional) return 'UNKNOWN_SENDER';

  const parsed = parseReply(msg.body);

  // Resolve which request this reply is about.
  const { rows: pending } = await deps.pool.query(
    `SELECT id, ref_code, state FROM requests
     WHERE professional_id = $1 AND state = ANY($2) ORDER BY created_at`,
    [professional.id, OPEN_STATES],
  );

  let request: { id: string; ref_code: string; state: RequestState } | undefined;
  if (parsed.refCode) {
    const { rows } = await deps.pool.query(
      `SELECT id, ref_code, state FROM requests WHERE professional_id = $1 AND ref_code = $2`,
      [professional.id, parsed.refCode],
    );
    request = rows[0];
    if (!request) {
      await enqueue(deps, null, professional.whatsapp_e164, 'REPROMPT', {
        refCode: parsed.refCode,
        hint: `I don't know that request code. Reply to the original card, or include its #REF code.`,
      }, `wa:${msg.waMessageId}`);
      await markIntent(deps, inboundId, 'UNKNOWN', null);
      return 'REPROMPTED';
    }
  } else if (pending.length === 1) {
    request = pending[0];
  } else if (pending.length > 1) {
    await enqueue(deps, null, professional.whatsapp_e164, 'WHICH_REQUEST', {
      refCodes: pending.map((p) => p.ref_code),
    }, `wa:${msg.waMessageId}`);
    await markIntent(deps, inboundId, 'AMBIGUOUS', null);
    return 'WHICH_REQUEST';
  } else {
    // No open card: answer with the status of the most recent request.
    const { rows } = await deps.pool.query(
      `SELECT id, ref_code, state FROM requests WHERE professional_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [professional.id],
    );
    request = rows[0];
  }

  if (!request) {
    await markIntent(deps, inboundId, 'IGNORED', null);
    return 'IGNORED';
  }

  // Settled/expired requests get status + money outcome — never act twice.
  if (request.state !== 'HELD') {
    await enqueue(deps, request.id, professional.whatsapp_e164, 'STATUS_SUMMARY', {
      refCode: request.ref_code,
      state: request.state,
      moneyLine: moneyLine(request.state),
    }, `wa:${msg.waMessageId}`);
    await markIntent(deps, inboundId, 'STATUS_QUERY', request.id);
    return 'STATUS_REPLIED';
  }

  // Counter-offer flow stage, derived from the previous marker.
  const { rows: prior } = await deps.pool.query(
    `SELECT parsed_intent FROM inbound_messages
     WHERE professional_id = $1 AND matched_request_id = $2 AND id <> $3
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [professional.id, request.id, inboundId],
  );
  const stage: string | null = prior[0]?.parsed_intent ?? null;

  if (stage === COUNTER_COLLECTING) {
    return handleCounterSlots(deps, msg, inboundId, professional, request);
  }
  if (stage === COUNTER_AWAITING_CONFIRM) {
    return handleCounterConfirm(deps, msg, inboundId, professional, request, parsed.intent);
  }

  switch (parsed.intent) {
    case 'ACCEPT':
    case 'CONFIRM_YES': {
      await acceptRequest(deps, request.id, 'PROFESSIONAL');
      await markIntent(deps, inboundId, 'ACCEPT', request.id);
      return 'ACCEPTED';
    }
    case 'DECLINE':
    case 'CONFIRM_NO': {
      await transition(deps.pool, request.id, 'DECLINED', 'PROFESSIONAL', 'DECLINE', {}, { now: deps.now() });
      await markIntent(deps, inboundId, 'DECLINE', request.id);
      return 'DECLINED';
    }
    case 'DECLINE_NEED_INFO': {
      await transition(deps.pool, request.id, 'DECLINED', 'PROFESSIONAL', 'DECLINE_NEED_INFO', {}, { now: deps.now() });
      await markIntent(deps, inboundId, 'DECLINE_NEED_INFO', request.id);
      return 'DECLINED';
    }
    case 'DECLINE_WRONG_TIME': {
      // Counter-offers are a professional-only flow (they reprice by tier
      // and rebook via Cal.com); SERVICE providers just decline.
      if (professional.provider_type === 'SERVICE') {
        await transition(deps.pool, request.id, 'DECLINED', 'PROFESSIONAL', 'DECLINE_WRONG_TIME', {}, { now: deps.now() });
        await markIntent(deps, inboundId, 'DECLINE', request.id);
        return 'DECLINED';
      }
      // One counter round per request, enforced by the UNIQUE constraint.
      const { rows } = await deps.pool.query(`SELECT 1 FROM counter_offers WHERE request_id = $1`, [request.id]);
      if (rows.length > 0) {
        await transition(deps.pool, request.id, 'DECLINED', 'PROFESSIONAL', 'DECLINE_WRONG_TIME_SECOND_ROUND', {}, { now: deps.now() });
        await markIntent(deps, inboundId, 'DECLINE', request.id);
        return 'DECLINED';
      }
      await enqueue(deps, request.id, professional.whatsapp_e164, 'COUNTER_PROMPT', { refCode: request.ref_code }, `wa:${msg.waMessageId}`);
      await markIntent(deps, inboundId, COUNTER_COLLECTING, request.id);
      return 'COUNTER_STARTED';
    }
    default: {
      await enqueue(deps, request.id, professional.whatsapp_e164, 'REPROMPT', {
        refCode: request.ref_code,
        hint: 'Reply 1 to accept, 2 to decline, 3 to suggest another time, 4 if you need more information.',
      }, `wa:${msg.waMessageId}`);
      await markIntent(deps, inboundId, 'UNKNOWN', request.id);
      return 'REPROMPTED';
    }
  }
}

// The slots message is parsed ONCE, here, and stored as draft
// counter_offers rows — the echo and what the client eventually sees are
// guaranteed to be the same parse. YES merely confirms the draft.
async function handleCounterSlots(
  deps: AppDeps,
  msg: InboundMessage,
  inboundId: string,
  professional: { id: string; whatsapp_e164: string; calcom_user_id: number },
  request: { id: string; ref_code: string },
): Promise<InboundOutcome> {
  const now = deps.now();
  const { slots } = parseCounterSlots(msg.body, now);
  if (slots.length === 0) {
    await enqueue(deps, request.id, professional.whatsapp_e164, 'REPROMPT', {
      refCode: request.ref_code,
      hint: 'I couldn\'t read those times. Send up to 3 alternatives, one per line, e.g. "tomorrow 2pm".',
    }, `wa:${msg.waMessageId}`);
    await markIntent(deps, inboundId, COUNTER_COLLECTING, request.id); // stay in this stage
    return 'REPROMPTED';
  }

  const { rows: reqRows } = await deps.pool.query(
    `SELECT duration_minutes, price_gross FROM requests WHERE id = $1`,
    [request.id],
  );
  const durationMinutes: number = reqRows[0].duration_minutes;
  const originalGross: string = reqRows[0].price_gross;

  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: coRows } = await client.query(
      `INSERT INTO counter_offers (request_id, expires_at) VALUES ($1, $2) RETURNING id`,
      [request.id, new Date(now.getTime() + 12 * 3600_000)],
    );
    for (const slot of slots) {
      const dayBefore = new Date(slot.start.getTime() - 24 * 3600_000);
      const dayAfter = new Date(slot.start.getTime() + 24 * 3600_000);
      const [availability, isWorkingDay] = await Promise.all([
        deps.scheduling.getAvailability(professional.calcom_user_id, dayBefore, dayAfter),
        deps.scheduling.isWorkingDay(professional.calcom_user_id, slot.start),
      ]);
      const tier: Tier = classifyTier({ requestedStart: slot.start, durationMinutes, now, availability, isWorkingDay });
      const tierPrice = priceFor(deps.pricing, professional.id, tier);
      const gross = fromCents(Math.min(toCents(originalGross), toCents(tierPrice)));
      await client.query(
        `INSERT INTO counter_offer_slots (counter_offer_id, slot_start, duration_minutes, tier, price_gross)
         VALUES ($1, $2, $3, $4, $5)`,
        [coRows[0].id, slot.start, durationMinutes, tier, gross],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await enqueue(deps, request.id, professional.whatsapp_e164, 'COUNTER_CONFIRM_ECHO', {
    refCode: request.ref_code,
    slots: slots.map((s) => ({ sessionStart: s.start.toISOString(), durationMinutes })),
  }, `wa:${msg.waMessageId}`);
  await markIntent(deps, inboundId, COUNTER_AWAITING_CONFIRM, request.id);
  return 'COUNTER_ECHOED';
}

async function handleCounterConfirm(
  deps: AppDeps,
  msg: InboundMessage,
  inboundId: string,
  professional: { id: string; whatsapp_e164: string },
  request: { id: string; ref_code: string },
  intent: ReturnType<typeof parseReply>['intent'],
): Promise<InboundOutcome> {
  const now = deps.now();

  if (intent === 'CONFIRM_NO' || intent === 'DECLINE') {
    // Discard the draft so a fresh round can be collected (the UNIQUE
    // constraint allows only one counter_offers row per request).
    await deps.pool.query(
      `DELETE FROM counter_offer_slots WHERE counter_offer_id IN (SELECT id FROM counter_offers WHERE request_id = $1)`,
      [request.id],
    );
    await deps.pool.query(`DELETE FROM counter_offers WHERE request_id = $1`, [request.id]);
    await enqueue(deps, request.id, professional.whatsapp_e164, 'COUNTER_PROMPT', { refCode: request.ref_code }, `wa:${msg.waMessageId}`);
    await markIntent(deps, inboundId, COUNTER_COLLECTING, request.id);
    return 'COUNTER_STARTED';
  }
  if (intent !== 'CONFIRM_YES' && intent !== 'ACCEPT') {
    await enqueue(deps, request.id, professional.whatsapp_e164, 'REPROMPT', {
      refCode: request.ref_code,
      hint: 'Reply YES to send these times to the client, or NO to start over.',
    }, `wa:${msg.waMessageId}`);
    await markIntent(deps, inboundId, COUNTER_AWAITING_CONFIRM, request.id); // stay in this stage
    return 'REPROMPTED';
  }

  const { rows } = await deps.pool.query(`SELECT id FROM counter_offers WHERE request_id = $1 AND resolved_at IS NULL`, [request.id]);
  if (rows.length === 0) throw new Error(`Counter confirm without a draft offer for request ${request.id}`);
  // The 12h client window starts at confirmation, not at slot collection.
  await deps.pool.query(`UPDATE counter_offers SET expires_at = $2 WHERE id = $1`, [
    rows[0].id,
    new Date(now.getTime() + 12 * 3600_000),
  ]);

  await transition(deps.pool, request.id, 'COUNTER_OFFERED', 'PROFESSIONAL', 'COUNTER_OFFER', {}, { now });
  await markIntent(deps, inboundId, 'COUNTER_CONFIRMED', request.id);
  return 'COUNTER_SENT';
}

function moneyLine(state: RequestState): string {
  switch (state) {
    case 'PENDING_PAYMENT':
      return 'Payment has not been completed yet.';
    case 'COUNTER_OFFERED':
      return 'Waiting for the client to pick one of your proposed times. Funds stay in escrow.';
    case 'ACCEPTED':
    case 'IN_SESSION':
      return 'Funds are committed and will be paid out after the session completes.';
    case 'COMPLETED':
    case 'NO_SHOW_CLIENT':
      return 'Your payout has been released.';
    case 'DECLINED':
    case 'EXPIRED':
    case 'NO_SHOW_PROFESSIONAL':
      return "The client's refund is being processed.";
    case 'REFUNDED':
      return 'The client was fully refunded.';
    default:
      return 'No money has moved on this request.';
  }
}

async function markIntent(deps: AppDeps, inboundId: string, intent: string, requestId: string | null): Promise<void> {
  await deps.pool.query(`UPDATE inbound_messages SET parsed_intent = $2, matched_request_id = $3 WHERE id = $1`, [
    inboundId,
    intent,
    requestId,
  ]);
}

async function enqueue(
  deps: AppDeps,
  requestId: string | null,
  recipient: string,
  templateKey: string,
  payload: Record<string, unknown>,
  dedupeKey: string,
): Promise<void> {
  await deps.pool.query(
    `INSERT INTO outbox_messages (request_id, channel, recipient, template_key, payload, idempotency_key)
     VALUES ($1, 'WHATSAPP', $2, $3, $4, $5) ON CONFLICT (idempotency_key) DO NOTHING`,
    [requestId, recipient, templateKey, JSON.stringify(payload), `${requestId ?? 'none'}:${templateKey}:${dedupeKey}`],
  );
}
