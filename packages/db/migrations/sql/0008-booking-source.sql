-- Attribution: where did this booking / message originate? 'qr' when the
-- client arrived via a professional's printed QR poster, 'web' otherwise.
-- Nullable + no default so historical rows stay untagged rather than
-- pretending to be web-sourced.

ALTER TABLE requests        ADD COLUMN source text;
ALTER TABLE direct_messages ADD COLUMN source text;
