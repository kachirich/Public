import type { AppDeps } from '../deps.js';
import { QuoteError } from './quotes.js';

// Paid direct messages — the professional's spam gate. A message reaches
// their WhatsApp only after the client pays the fee the professional set in
// the portal. Payment confirmation (webhook or dev route) triggers the
// outbox forward; nothing is sent on mere intent.

export async function createDirectMessage(
  deps: AppDeps,
  input: { clientId: string; professionalId: string; body: string; source?: string },
): Promise<{ directMessageId: string; fee: string; currency: string; authorizationUrl: string }> {
  const body = input.body.trim();
  if (!body) throw new QuoteError(400, 'message body is required');
  if (body.length > 500) throw new QuoteError(422, 'keep the message under 500 characters');

  const { rows: profRows } = await deps.pool.query(
    `SELECT id, direct_message_fee FROM professionals
     WHERE id = $1 AND is_active AND verification_status = 'VERIFIED'`,
    [input.professionalId],
  );
  if (!profRows[0]) throw new QuoteError(404, 'professional not found');

  const { rows: clientRows } = await deps.pool.query(
    `SELECT id, email, phone_e164 FROM clients WHERE id = $1`,
    [input.clientId],
  );
  const client = clientRows[0];
  if (!client) throw new QuoteError(404, 'client not found');

  const fee: string = profRows[0].direct_message_fee;
  const { rows } = await deps.pool.query(
    `INSERT INTO direct_messages (client_id, professional_id, body, fee, source)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, currency`,
    [input.clientId, input.professionalId, body, fee, input.source ?? 'web'],
  );
  const dm = rows[0];

  const { authorizationUrl, providerRef } = await deps.payments.initPayment({
    requestId: dm.id,
    amount: fee,
    currency: dm.currency.trim(),
    clientEmail: client.email ?? 'unknown@example.com',
    ...(client.phone_e164 ? { clientPhone: client.phone_e164 } : {}),
  });
  await deps.pool.query(`UPDATE direct_messages SET provider_ref = $2 WHERE id = $1`, [dm.id, providerRef]);

  return { directMessageId: dm.id, fee, currency: dm.currency.trim(), authorizationUrl };
}

/** Idempotent: a second confirmation for the same message is a no-op. */
export async function confirmDirectMessage(deps: AppDeps, directMessageId: string): Promise<boolean> {
  const { rows } = await deps.pool.query(
    `UPDATE direct_messages SET state = 'PAID'
     WHERE id = $1 AND state = 'PENDING_PAYMENT' RETURNING client_id, professional_id, body, fee, currency`,
    [directMessageId],
  );
  const dm = rows[0];
  if (!dm) return false;

  const { rows: pro } = await deps.pool.query(
    `SELECT whatsapp_e164, preferred_channel, dm_note FROM professionals WHERE id = $1`,
    [dm.professional_id],
  );
  const { rows: client } = await deps.pool.query(`SELECT display_name FROM clients WHERE id = $1`, [dm.client_id]);

  await deps.pool.query(
    `INSERT INTO outbox_messages (request_id, channel, recipient, template_key, payload, idempotency_key)
     VALUES (NULL, $1, $2, 'DIRECT_MESSAGE', $3, $4) ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      pro[0].preferred_channel,
      pro[0].whatsapp_e164,
      JSON.stringify({
        clientName: client[0].display_name,
        body: dm.body,
        feeLine: `${dm.currency.trim()} ${dm.fee} paid`,
        ...(pro[0].dm_note ? { note: pro[0].dm_note } : {}),
      }),
      `dm:${directMessageId}`,
    ],
  );
  return true;
}

/** Payment providers echo back only their own ref; map it to the message. */
export async function findDirectMessageByProviderRef(deps: AppDeps, providerRef: string): Promise<string | null> {
  const { rows } = await deps.pool.query(`SELECT id FROM direct_messages WHERE provider_ref = $1`, [providerRef]);
  return rows[0]?.id ?? null;
}
