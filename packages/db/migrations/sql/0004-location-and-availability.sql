-- Location search + professional-managed availability.
--
-- location_area powers the client-side "near me" filter (coarse area names,
-- not coordinates — that is deliberate for v1).
--
-- professional_availability is the professional's own weekly schedule,
-- entered through the portal with explicit consent (availability_consent_at).
-- In deployments with Cal.com configured, Cal.com remains the scheduling
-- source of truth; this table drives the dev scheduler and the portal UI.

ALTER TABLE professionals
  ADD COLUMN location_area text,
  ADD COLUMN availability_consent_at timestamptz;

CREATE TABLE professional_availability (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id  uuid NOT NULL REFERENCES professionals(id),
  weekday          integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday (UTC)
  start_minute     integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute       integer NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  CHECK (end_minute > start_minute),
  UNIQUE (professional_id, weekday)
);

CREATE INDEX idx_availability_professional ON professional_availability(professional_id);
