-- Claim flow: links a professionals row to an AuthKit account (apps/authkit-service).
-- Orthogonal to verification_status, which continues to gate client-facing
-- bookability (browse listing, quotes) and is untouched here. claim_status
-- gates portal (/pro) access only — an unclaimed/imported professional stays
-- publicly bookable, they just can't sign into their own dashboard until an
-- AuthKit account claims the row.
--
-- authkit_user_id is a plain UUID, not a real foreign key: authkit-service
-- owns a separate Postgres database/schema from this one. It's validated at
-- the application layer (orchestrator's POST /pro/:id/claim), not by a DB
-- constraint.

CREATE TYPE claim_status AS ENUM (
  'UNCLAIMED',         -- generated/imported, nobody has claimed it yet
  'HOSPITAL_VERIFIED',  -- bulk-sourced from an institution's own staff directory; higher starting confidence than UNCLAIMED
  'FULLY_ACTIVATED'    -- an AuthKit account has claimed it and completed WhatsApp OTP
);

ALTER TABLE professionals
  ADD COLUMN claim_status claim_status NOT NULL DEFAULT 'FULLY_ACTIVATED';
-- Default FULLY_ACTIVATED preserves current behavior for every existing row
-- (self-registered professionals who already proved WhatsApp ownership via
-- the existing verification pipeline) with no backfill statement needed —
-- they don't need a separate "claim" step.

ALTER TABLE professionals
  ADD COLUMN authkit_user_id uuid,
  ADD COLUMN claimed_at timestamptz;

-- One AuthKit account claims at most one professional profile (v1 rule).
CREATE UNIQUE INDEX idx_professionals_authkit_user_id
  ON professionals(authkit_user_id) WHERE authkit_user_id IS NOT NULL;

CREATE INDEX idx_professionals_claim_status
  ON professionals(claim_status) WHERE claim_status != 'FULLY_ACTIVATED';
