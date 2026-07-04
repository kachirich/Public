import { SlotTakenError } from '@marketplace/core';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './deps.js';
import { chooseCounterSlot } from './services/accept.js';
import { confirmQuotePayment, createQuote, initQuotePayment, QuoteError } from './services/quotes.js';
import {
  confirmVerificationOtp,
  decideVerification,
  pendingVerifications,
  submitVerification,
} from './services/verification.js';
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

  // Find-or-create for the web booking flow (no auth system yet; email is
  // the identity key).
  app.post<{ Body: { displayName: string; email: string; phone?: string } }>('/clients', async (req, reply) => {
    const { displayName, email, phone } = req.body ?? {};
    if (!displayName || !email) return reply.code(400).send({ error: 'displayName and email are required' });
    const { rows: existing } = await deps.pool.query(`SELECT id FROM clients WHERE email = $1`, [email]);
    if (existing[0]) return { clientId: existing[0].id };
    const { rows } = await deps.pool.query(
      `INSERT INTO clients (display_name, email, phone_e164) VALUES ($1, $2, $3) RETURNING id`,
      [displayName, email, phone ?? null],
    );
    return reply.code(201).send({ clientId: rows[0].id });
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

  // The addendum's listing rule is enforced here, not in the UI:
  // non-verified professionals never appear in client-facing responses.
  app.get('/professionals', async () => {
    const { rows } = await deps.pool.query(
      `SELECT id, display_name FROM professionals
       WHERE is_active AND verification_status = 'VERIFIED'
       ORDER BY display_name`,
    );
    return { professionals: rows };
  });

  app.get<{ Params: { id: string } }>('/requests/:id', async (req, reply) => {
    const { rows } = await deps.pool.query(
      `SELECT r.id, r.ref_code, r.state, r.tier, r.session_start, r.duration_minutes,
              r.currency, r.price_gross, r.platform_fee, r.payout_net,
              r.card_expires_at, r.version, r.created_at,
              p.display_name AS professional_name
       FROM requests r JOIN professionals p ON p.id = r.professional_id
       WHERE r.id = $1`,
      [req.params.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'request not found' });
    const { rows: history } = await deps.pool.query(
      `SELECT from_state, to_state, actor, reason_code, created_at
       FROM request_transitions WHERE request_id = $1 ORDER BY id`,
      [req.params.id],
    );

    // COUNTER_OFFERED requests carry the proposed slots so the client UI
    // can render the chooser.
    let counterOffer = null;
    if (rows[0].state === 'COUNTER_OFFERED') {
      const { rows: offers } = await deps.pool.query(
        `SELECT co.id, co.expires_at,
                json_agg(json_build_object(
                  'id', s.id, 'slotStart', s.slot_start,
                  'durationMinutes', s.duration_minutes,
                  'tier', s.tier, 'priceGross', s.price_gross::text
                ) ORDER BY s.slot_start) AS slots
         FROM counter_offers co
         JOIN counter_offer_slots s ON s.counter_offer_id = co.id
         WHERE co.request_id = $1 AND co.resolved_at IS NULL
         GROUP BY co.id`,
        [req.params.id],
      );
      counterOffer = offers[0] ?? null;
    }

    return { ...rows[0], transitions: history, counterOffer };
  });

  app.post<{ Params: { id: string }; Body: { slotId: string } }>('/counter-offers/:id/choose', async (req, reply) => {
    const slotId = req.body?.slotId;
    if (!slotId) return reply.code(400).send({ error: 'slotId is required' });
    await chooseCounterSlot(deps, req.params.id, slotId);
    return reply.code(200).send({ accepted: true });
  });

  // ---------- professional verification (phase 7) ----------

  app.post<{ Params: { id: string }; Body: { registry: string; registrationNumber: string; submittedName: string } }>(
    '/professionals/:id/verifications',
    async (req, reply) => {
      const { registry, registrationNumber, submittedName } = req.body ?? {};
      if (!registry || !registrationNumber || !submittedName) {
        return reply.code(400).send({ error: 'registry, registrationNumber, submittedName are required' });
      }
      const result = await submitVerification(deps, {
        professionalId: req.params.id,
        registry: registry as never,
        registrationNumber,
        submittedName,
      });
      return reply.code(201).send(result);
    },
  );

  app.post<{ Params: { id: string }; Body: { code: string } }>('/verifications/:id/otp', async (req, reply) => {
    const code = req.body?.code;
    if (!code) return reply.code(400).send({ error: 'code is required' });
    return confirmVerificationOtp(deps, req.params.id, code);
  });

  app.get('/internal/verifications/pending', async (req, reply) => {
    if (req.headers['x-internal-secret'] !== deps.sharedSecret) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return { pending: await pendingVerifications(deps) };
  });

  app.post<{ Params: { id: string }; Body: { decision: 'approve' | 'reject'; reviewedBy: string } }>(
    '/internal/verifications/:id/decide',
    async (req, reply) => {
      if (req.headers['x-internal-secret'] !== deps.sharedSecret) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const { decision, reviewedBy } = req.body ?? {};
      if (!['approve', 'reject'].includes(decision) || !reviewedBy) {
        return reply.code(400).send({ error: 'decision (approve|reject) and reviewedBy are required' });
      }
      return decideVerification(deps, req.params.id, decision, reviewedBy);
    },
  );
}
