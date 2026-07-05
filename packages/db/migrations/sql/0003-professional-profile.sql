-- Professional profile fields for client-facing listings: what kind of
-- professional this is (drives the category filter) and the institution
-- they practice at (a lecturer's university, a doctor's hospital).

CREATE TYPE professional_category AS ENUM (
  'DOCTOR',
  'LECTURER',
  'LAWYER',
  'ACCOUNTANT',
  'ENGINEER',
  'THERAPIST'
);

ALTER TABLE professionals
  ADD COLUMN category professional_category NOT NULL DEFAULT 'LECTURER',
  ADD COLUMN affiliation text,                -- e.g. "University of Nairobi", "Aga Khan University Hospital"
  ADD COLUMN title text,                      -- e.g. "Senior Lecturer, Computer Science"
  ADD COLUMN bio text;

CREATE INDEX idx_professionals_category ON professionals(category)
  WHERE is_active;
