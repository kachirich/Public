-- ============================================================
-- Professional Access Marketplace — Core Schema (Postgres 15+)
-- Source of truth for the orchestrator. Cal.com keeps its own
-- database; this schema stores only references to it.
--
-- This file is the initial migration only. Phase 7 (professional
-- verification — see claude-code-prompt.md) adds verification_status
-- to professionals and a professional_verifications table via a
-- separate, later migration. Do not add those here.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- Enums ----------

CREATE TYPE request_tier AS ENUM (
  'IN_HOURS',            -- inside Cal.com availability (normal booking)
  'OFF_DUTY',            -- working day, outside working hours
  'OFF_DAY',             -- blocked / non-working day
  'PREMIUM_INTERRUPT'    -- immediate access
);

CREATE TYPE request_state AS ENUM (
  'REQUESTED',           -- quote generated, unpaid
  'PENDING_PAYMENT',     -- payment initiated with provider
  'HELD',                -- funds in escrow, card sent to professional
  'COUNTER_OFFERED',     -- professional proposed alternative slots
  'ACCEPTED',            -- funds committed, Cal.com booking created
  'IN_SESSION',          -- consult room open
  'COMPLETED',           -- session done, payout released
  'DECLINED',            -- professional declined (refund pending)
  'EXPIRED',             -- card or counter-offer timed out (refund pending)
  'NO_SHOW_PROFESSIONAL',-- professional absent (refund pending)
  'NO_SHOW_CLIENT',      -- client absent (professional paid in full)
  'REFUNDED',            -- refund confirmed by provider (terminal)
  'CANCELLED'            -- abandoned before funds were held (terminal)
);

CREATE TYPE ledger_entry_type AS ENUM (
  'HOLD',                -- client funds captured into escrow
  'COMMIT',              -- funds locked to an accepted session
  'RELEASE',             -- payout to professional
  'REFUND',              -- full refund to client
  'PARTIAL_REFUND',      -- e.g. counter-offer landed in a cheaper tier
  'PLATFORM_FEE'         -- platform cut recognised
);

CREATE TYPE message_channel AS ENUM ('WHATSAPP', 'EMAIL', 'TELEGRAM');
CREATE TYPE outbox_status  AS ENUM ('PENDING', 'SENT', 'FAILED', 'DEAD');
CREATE TYPE job_status     AS ENUM ('SCHEDULED', 'DONE', 'SKIPPED');
CREATE TYPE actor_type     AS ENUM ('CLIENT', 'PROFESSIONAL', 'SYSTEM', 'TIMER');

-- ---------- Parties ----------

CREATE TABLE professionals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name       text NOT NULL,
  whatsapp_e164      text NOT NULL UNIQUE,          -- primary channel
  email              text,
  preferred_channel  message_channel NOT NULL DEFAULT 'WHATSAPP',
  calcom_user_id     integer NOT NULL,               -- reference into Cal.com
  calcom_event_type  integer NOT NULL,               -- default event type id
  payout_method      jsonb NOT NULL,                 -- {type:'MPESA', msisdn:'...'} etc.
  fee_percent        numeric(5,2) NOT NULL DEFAULT 15.00,
  no_show_count      integer NOT NULL DEFAULT 0,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name       text NOT NULL,
  phone_e164         text UNIQUE,
  email              text UNIQUE,
  is_verified        boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------- Requests (the aggregate root) ----------

CREATE TABLE requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_code           text NOT NULL UNIQUE,           -- short human code, e.g. R4X2
  client_id          uuid NOT NULL REFERENCES clients(id),
  professional_id    uuid NOT NULL REFERENCES professionals(id),
  tier               request_tier NOT NULL,
  state              request_state NOT NULL DEFAULT 'REQUESTED',
  session_start      timestamptz NOT NULL,           -- updated if a counter-slot is accepted
  duration_minutes   integer NOT NULL,
  brief              text NOT NULL,
  currency           char(3) NOT NULL DEFAULT 'KES',
  price_gross        numeric(12,2) NOT NULL,
  platform_fee       numeric(12,2) NOT NULL,
  payout_net         numeric(12,2) NOT NULL,
  calcom_booking_id  integer,                        -- set on ACCEPTED
  card_expires_at    timestamptz,                    -- tier-scaled acceptance deadline
  version            integer NOT NULL DEFAULT 0,     -- optimistic locking
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_math CHECK (payout_net = price_gross - platform_fee)
);

CREATE INDEX idx_requests_state          ON requests(state);
CREATE INDEX idx_requests_professional   ON requests(professional_id, state);
CREATE INDEX idx_requests_card_expiry    ON requests(card_expires_at)
  WHERE state IN ('HELD', 'COUNTER_OFFERED');

-- Append-only audit of every state change. The requests.state column is a
-- cache of the latest row here; this table is the truth for disputes.
CREATE TABLE request_transitions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id    uuid NOT NULL REFERENCES requests(id),
  from_state    request_state NOT NULL,
  to_state      request_state NOT NULL,
  actor         actor_type NOT NULL,
  reason_code   text,                                -- e.g. DECLINE_WRONG_TIME
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_transitions_request ON request_transitions(request_id, created_at);

-- ---------- Counter-offers (one round, max 3 slots) ----------

CREATE TABLE counter_offers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL UNIQUE REFERENCES requests(id),  -- UNIQUE = one round only
  expires_at    timestamptz NOT NULL,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE counter_offer_slots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counter_offer_id  uuid NOT NULL REFERENCES counter_offers(id),
  slot_start        timestamptz NOT NULL,
  duration_minutes  integer NOT NULL,
  tier              request_tier NOT NULL,           -- re-classified per slot
  price_gross       numeric(12,2) NOT NULL,          -- min(original, slot tier price)
  is_chosen         boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX one_chosen_slot
  ON counter_offer_slots(counter_offer_id) WHERE is_chosen;

-- ---------- Money (append-only ledger) ----------

CREATE TABLE ledger_entries (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id    uuid NOT NULL REFERENCES requests(id),
  entry_type    ledger_entry_type NOT NULL,
  amount        numeric(12,2) NOT NULL,
  currency      char(3) NOT NULL DEFAULT 'KES',
  provider_ref  text,                                -- Paystack/Daraja transaction ref
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_request ON ledger_entries(request_id);

-- ---------- Messaging (transactional outbox) ----------

CREATE TABLE outbox_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid REFERENCES requests(id),
  channel          message_channel NOT NULL,
  recipient        text NOT NULL,                    -- E.164 or email
  template_key     text NOT NULL,                    -- e.g. REQUEST_CARD, ACCEPTED_CLIENT
  payload          jsonb NOT NULL,                   -- template variables
  idempotency_key  text NOT NULL UNIQUE,             -- request_id:template_key:transition_id
  status           outbox_status NOT NULL DEFAULT 'PENDING',
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_pending ON outbox_messages(next_attempt_at)
  WHERE status IN ('PENDING', 'FAILED');

-- Raw inbound WhatsApp messages + how the gateway parsed them.
CREATE TABLE inbound_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id    uuid REFERENCES professionals(id),
  wa_message_id      text NOT NULL UNIQUE,           -- OpenWA message id (dedup)
  body               text NOT NULL,
  parsed_intent      text,                           -- ACCEPT / DECLINE / COUNTER / UNKNOWN
  matched_request_id uuid REFERENCES requests(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------- External event idempotency ----------

CREATE TABLE webhook_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL,                       -- 'paystack' | 'calcom' | 'openwa'
  external_id   text NOT NULL,                       -- provider's event id
  payload       jsonb NOT NULL,
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)                       -- duplicate webhooks become no-ops
);

-- ---------- Consult rooms ----------

CREATE TABLE consult_rooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL UNIQUE REFERENCES requests(id),
  wa_group_id   text NOT NULL,                       -- OpenWA group id
  opened_at     timestamptz,
  dissolved_at  timestamptz
);

-- ---------- Durable timers ----------
-- Persisted so timers survive restarts; each job re-reads request state
-- when it fires and becomes SKIPPED if the state has moved on.

CREATE TABLE scheduled_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES requests(id),
  job_type    text NOT NULL,   -- CARD_EXPIRY, CARD_REMINDER, COUNTER_EXPIRY,
                               -- ROOM_OPEN, SESSION_START_CHECK, NO_SHOW_CHECK,
                               -- SESSION_END_WARNING, SESSION_END, ROOM_DISSOLVE
  run_at      timestamptz NOT NULL,
  status      job_status NOT NULL DEFAULT 'SCHEDULED',
  fired_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_due ON scheduled_jobs(run_at) WHERE status = 'SCHEDULED';
