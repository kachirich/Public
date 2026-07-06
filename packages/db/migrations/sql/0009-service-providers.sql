-- Dynamic provider types.
--
-- PROFESSIONAL keeps the existing strict scheduling exactly as-is: Cal.com
-- (or the dev stub) owns the calendar, one client per slot, tier-classified
-- pricing (IN_HOURS / OFF_DUTY / OFF_DAY / PREMIUM_INTERRUPT).
--
-- SERVICE providers (salons, garages, field businesses) register lightly
-- (name + business + WhatsApp OTP, no registry verification) and take
-- bookings into fluid multi-capacity windows: each availability window
-- carries its own capacity, and overlapping bookings are admitted until
-- the window is full. Their bookings never touch Cal.com, so the calcom
-- reference columns become optional.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE provider_type AS ENUM ('PROFESSIONAL', 'SERVICE');

ALTER TABLE professionals
  ADD COLUMN provider_type provider_type NOT NULL DEFAULT 'PROFESSIONAL',
  ADD COLUMN business_name text,
  ADD COLUMN service_flat_price numeric(12,2),   -- flat in-window price (SERVICE only)
  ALTER COLUMN calcom_user_id DROP NOT NULL,
  ALTER COLUMN calcom_event_type DROP NOT NULL;

-- SERVICE providers appear in listings under their own category.
ALTER TYPE professional_category ADD VALUE IF NOT EXISTS 'SERVICE';

-- Requests against SERVICE providers use a single flat tier.
ALTER TYPE request_tier ADD VALUE IF NOT EXISTS 'STANDARD';

ALTER TABLE professional_availability
  ADD COLUMN capacity integer NOT NULL DEFAULT 1 CHECK (capacity >= 1);

-- Multiple windows per weekday are now allowed (fluid schedules), but they
-- must never overlap: occupancy counting assumes exactly one covering
-- window per instant.
ALTER TABLE professional_availability
  DROP CONSTRAINT professional_availability_professional_id_weekday_key;

ALTER TABLE professional_availability
  ADD CONSTRAINT no_overlapping_windows
    EXCLUDE USING gist (
      professional_id WITH =,
      weekday WITH =,
      int4range(start_minute, end_minute) WITH &&
    );
