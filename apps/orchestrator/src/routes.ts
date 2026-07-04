import { SlotTakenError } from '@marketplace/core';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './deps.js';
import { chooseCounterSlot } from './services/accept.js';
import { confirmQuotePayment, createQuote, initQuotePayment, QuoteError } from './services/quotes.js';
import { handleWaInbound } from './services/wa-inbound.js';

interface QuoteBody {
  clientId: string;
  professionalId: string;
  sessionStart: string;
  durationMinutes: number;
  brief: string;
}

export function registerRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof QuoteError) return reply.code(err.statusCode).send({ error: err.message });
    if (err instanceof SlotTakenError) return reply.code(409).send({ error: 'slot no longer available' });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal error' });
  });

  app.post<{ Body: QuoteBody }>('/quotes', async (req, reply) => {
    const { clientId, professionalId, sessionStart, durationMinutes, brief } = req.body ?? ({} as QuoteBody);
    if (!clientId || !professionalId || !sessionStart || !durationMinutes || !brief) {
      return reply.code(400).send({ error: 'clientId, professionalId, sessionStart, durationMinutes, brief are required' });
    }
    const start = new Date(sessionStart);
    if (Number.isNaN(start.getTime())) return reply.code(400).send({ error: 'sessionStart must be an ISO datetime' });
    const quote = await createQuote(deps, { clientId, professionalId, sessionStart: start, durationMinutes, brief });
    return reply.code(201).send(quote);
  });

  app.post<{ Params: { id: string } }>('/quotes/:id/pay', async (req) => {
    return initQuotePayment(deps, req.params.id);
  });

  // Idempotency first: the webhook_events unique index makes duplicate
  // deliveries no-ops before any business logic runs.
  app.post('/webhooks/paystack', async (req, reply) => {
    const signature = req.headers['x-paystack-signature'];
    const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
    if (typeof signature !== 'string' || !deps.payments.verifyWebhookSignature(rawBody, signature)) {
      return reply.code(401).send({ error: 'invalid signature' });
    }

    const event = req.body as { event: string; data: { id: number | string; reference: string } };
    const externalId = String(event.data?.id ?? '');
    if (!event.event || !externalId) return reply.code(400).send({ error: 'malformed event' });

    const { rows } = await deps.pool.query(
      `INSERT INTO webhook_events (source, external_id, payload)
       VALUES ('paystack', $1, $2) ON CONFLICT (source, external_id) DO NOTHING RETURNING id`,
      [externalId, JSON.stringify(req.body)],
    );
    if (rows.length === 0) return { received: true, duplicate: true };

    if (event.event === 'charge.success' && event.data.reference?.startsWith('req-')) {
      const requestId = event.data.reference.slice(4);
      await confirmQuotePayment(deps, requestId, event.data.reference);
    }
    await deps.pool.query(`UPDATE webhook_events SET processed_at = now() WHERE id = $1`, [rows[0].id]);
    return { received: true };
  });

  app.post('/webhooks/calcom', async (req, reply) => {
    const event = req.body as { triggerEvent?: string; payload?: { uid?: string; bookingId?: number } };
    const externalId = event.payload?.uid ?? String(event.payload?.bookingId ?? '');
    if (!externalId) return reply.code(400).send({ error: 'malformed event' });
    await deps.pool.query(
      `INSERT INTO webhook_events (source, external_id, payload, processed_at)
       VALUES ('calcom', $1, $2, now()) ON CONFLICT (source, external_id) DO NOTHING`,
      [externalId, JSON.stringify(req.body)],
    );
    return { received: true };
  });

  app.post<{ Body: { waMessageId: string; fromE164: string; body: string } }>('/internal/wa-inbound', async (req, reply) => {
    if (req.headers['x-internal-secret'] !== deps.sharedSecret) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { waMessageId, fromE164, body } = req.body ?? {};
    if (!waMessageId || !fromE164 || body === undefined) {
      return reply.code(400).send({ error: 'waMessageId, fromE164, body are required' });
    }
    const outcome = await handleWaInbound(deps, { waMessageId, fromE164, body });
    return { outcome };
  });

  app.get<{ Params: { id: string } }>('/requests/:id', async (req, reply) => {
    const { rows } = await deps.pool.query(
      `SELECT id, ref_code, state, tier, session_start, duration_minutes,
              currency, price_gross, platform_fee, payout_net, card_expires_at, version, created_at
       FROM requests WHERE id = $1`,
      [req.params.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'request not found' });
    const { rows: history } = await deps.pool.query(
      `SELECT from_state, to_state, actor, reason_code, created_at
       FROM request_transitions WHERE request_id = $1 ORDER BY id`,
      [req.params.id],
    );
    return { ...rows[0], transitions: history };
  });

  app.post<{ Params: { id: string }; Body: { slotId: string } }>('/counter-offers/:id/choose', async (req, reply) => {
    const slotId = req.body?.slotId;
    if (!slotId) return reply.code(400).send({ error: 'slotId is required' });
    await chooseCounterSlot(deps, req.params.id, slotId);
    return reply.code(200).send({ accepted: true });
  });
}
