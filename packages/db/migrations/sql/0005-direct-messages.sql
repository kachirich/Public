-- Paid direct messages: the spam gate for professionals.
--
-- Clients never message a professional's WhatsApp for free — a message is
-- only forwarded after a small fee (set by the professional) is paid. The
-- fee is the filter: it costs nothing to ignore, but enough to deter bulk
-- and idle contact. dm_note is the professional's own template snippet
-- appended to every forwarded message (e.g. office hours, reply policy).

ALTER TABLE professionals
  ADD COLUMN direct_message_fee numeric(12,2) NOT NULL DEFAULT 50.00,
  ADD COLUMN dm_note text;

CREATE TABLE direct_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES clients(id),
  professional_id  uuid NOT NULL REFERENCES professionals(id),
  body             text NOT NULL,
  fee              numeric(12,2) NOT NULL,
  currency         char(3) NOT NULL DEFAULT 'KES',
  state            text NOT NULL DEFAULT 'PENDING_PAYMENT',  -- PENDING_PAYMENT | PAID
  provider_ref     text,                                     -- payment provider id (STK CheckoutRequestID)
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_direct_messages_provider_ref ON direct_messages(provider_ref);
CREATE INDEX idx_direct_messages_professional ON direct_messages(professional_id, created_at DESC);
