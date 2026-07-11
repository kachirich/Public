-- Professional-controlled availability status. Distinct from is_active
-- (an admin/lifecycle flag): an unavailable professional stays listed with
-- a "Not available" badge but cannot be quoted or booked until they flip
-- the toggle back in the portal.

ALTER TABLE professionals
  ADD COLUMN is_available boolean NOT NULL DEFAULT true;
