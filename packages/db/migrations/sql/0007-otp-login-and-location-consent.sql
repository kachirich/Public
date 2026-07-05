-- Portal OTP login + location privacy.
--
-- login_otps: short-lived challenges proving control of the WhatsApp number
-- before a portal session is issued. Codes are stored hashed; five wrong
-- attempts burn the challenge.
--
-- location_consent_at: a professional's area is never shown to clients
-- unless they opt in from the portal. The public anchor is the institution
-- (university / hospital / firm) — clients who need an address can find the
-- institution themselves.

ALTER TABLE professionals
  ADD COLUMN location_consent_at timestamptz;

CREATE TABLE login_otps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id  uuid NOT NULL REFERENCES professionals(id),
  code_hash        text NOT NULL,
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_login_otps_professional ON login_otps(professional_id, created_at DESC);
