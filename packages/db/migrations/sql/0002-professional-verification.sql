-- Phase 7: professional verification (see claude-code-prompt.md addendum).
-- Applied by migration 1700000000001; schema.sql stays the initial migration.

CREATE TYPE verification_status AS ENUM (
  'PENDING_VERIFICATION',   -- submitted, checks not yet passed
  'VERIFIED',               -- bookable
  'NEEDS_MANUAL_REVIEW',    -- automated check failed or inconclusive
  'REJECTED'                -- terminal
);

ALTER TABLE professionals
  ADD COLUMN verification_status verification_status
  NOT NULL DEFAULT 'PENDING_VERIFICATION';

CREATE TABLE professional_verifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id     uuid NOT NULL REFERENCES professionals(id),
  registry            text NOT NULL,          -- KMPDC | LSK | ICPAK | EBK | UNIVERSITY | OTHER
  registration_number text NOT NULL,
  submitted_name      text NOT NULL,          -- name the professional gave us
  registry_name       text,                   -- name found in the registry
  name_match_score    numeric(4,3),           -- 0.000-1.000 fuzzy match
  whatsapp_otp_passed boolean NOT NULL DEFAULT false,
  evidence            jsonb NOT NULL DEFAULT '{}',  -- raw lookup response, doc refs
  status              verification_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  checked_at          timestamptz,
  reviewed_by         text,                   -- null = automated decision
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_verifications_professional
  ON professional_verifications(professional_id, created_at DESC);
CREATE INDEX idx_verifications_review_queue
  ON professional_verifications(created_at)
  WHERE status = 'NEEDS_MANUAL_REVIEW';
