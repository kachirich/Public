import type { Pool } from 'pg';
import { resolveEffects, type RequestSnapshot, type TransitionMetadata } from './effects.js';
import { IllegalTransitionError, RequestNotFoundError, VersionConflictError } from './errors.js';
import { isLegalTransition, type ActorType, type RequestState } from './transitions.js';

export interface TransitionOptions {
  /** Fail with VersionConflictError if the row's version no longer matches the caller's read. */
  expectedVersion?: number;
  /** Injectable clock for deterministic timer tests. */
  now?: Date;
}

export interface TransitionResult {
  requestId: string;
  fromState: RequestState;
  toState: RequestState;
  transitionId: string;
  version: number;
}

const SELECT_FOR_UPDATE = `
  SELECT r.id, r.ref_code, r.client_id, r.professional_id, r.tier, r.state,
         r.session_start, r.duration_minutes, r.brief, r.currency,
         r.price_gross, r.platform_fee, r.payout_net,
         r.card_expires_at, r.version,
         p.whatsapp_e164 AS professional_whatsapp,
         p.preferred_channel AS professional_preferred_channel,
         c.phone_e164 AS client_phone,
         c.email AS client_email
  FROM requests r
  JOIN professionals p ON p.id = r.professional_id
  JOIN clients c ON c.id = r.client_id
  WHERE r.id = $1
  FOR UPDATE OF r
`;

// The ONLY code path that writes requests.state. One transaction:
// row lock -> version check -> legality check -> state update ->
// transition audit row -> ledger rows -> outbox rows -> timer rows.
export async function transition(
  pool: Pool,
  requestId: string,
  toState: RequestState,
  actor: ActorType,
  reasonCode: string | null,
  metadata: TransitionMetadata = {},
  options: TransitionOptions = {},
): Promise<TransitionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(SELECT_FOR_UPDATE, [requestId]);
    const row = rows[0];
    if (!row) throw new RequestNotFoundError(requestId);

    const req: RequestSnapshot = {
      id: row.id,
      refCode: row.ref_code,
      clientId: row.client_id,
      professionalId: row.professional_id,
      tier: row.tier,
      state: row.state,
      sessionStart: row.session_start,
      durationMinutes: row.duration_minutes,
      brief: row.brief,
      currency: row.currency,
      priceGross: row.price_gross,
      platformFee: row.platform_fee,
      payoutNet: row.payout_net,
      cardExpiresAt: row.card_expires_at,
      version: row.version,
      professionalWhatsapp: row.professional_whatsapp,
      professionalPreferredChannel: row.professional_preferred_channel,
      clientPhone: row.client_phone,
      clientEmail: row.client_email,
    };

    if (options.expectedVersion !== undefined && req.version !== options.expectedVersion) {
      throw new VersionConflictError(requestId, options.expectedVersion, req.version);
    }

    if (!isLegalTransition(req.state, toState)) {
      throw new IllegalTransitionError(requestId, req.state, toState);
    }

    const now = options.now ?? new Date();
    const effects = resolveEffects(req, toState, metadata, now);

    await client.query(
      `UPDATE requests SET state = $2, version = version + 1, updated_at = now() WHERE id = $1`,
      [requestId, toState],
    );

    const transitionInsert = await client.query(
      `INSERT INTO request_transitions (request_id, from_state, to_state, actor, reason_code, metadata)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [requestId, req.state, toState, actor, reasonCode, JSON.stringify(metadata)],
    );
    const transitionId: string = String(transitionInsert.rows[0].id);

    for (const entry of effects.ledger) {
      await client.query(
        `INSERT INTO ledger_entries (request_id, entry_type, amount, currency, provider_ref)
         VALUES ($1, $2, $3, $4, $5)`,
        [requestId, entry.entryType, entry.amount, req.currency, entry.providerRef],
      );
    }

    for (const n of effects.notifications) {
      // idempotency_key makes redelivered webhooks / retried callers unable
      // to enqueue the same notification twice for the same transition.
      await client.query(
        `INSERT INTO outbox_messages (request_id, channel, recipient, template_key, payload, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [requestId, n.channel, n.recipient, n.templateKey, JSON.stringify(n.payload), `${requestId}:${n.templateKey}:${transitionId}`],
      );
    }

    for (const timer of effects.timers) {
      await client.query(
        `INSERT INTO scheduled_jobs (request_id, job_type, run_at) VALUES ($1, $2, $3)`,
        [requestId, timer.jobType, timer.runAt],
      );
    }

    await client.query('COMMIT');
    return { requestId, fromState: req.state, toState, transitionId, version: req.version + 1 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
