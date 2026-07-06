const fs = require('node:fs');
const path = require('node:path');

const sqlPath = path.join(__dirname, 'sql', '0009-service-providers.sql');

exports.up = (pgm) => {
  pgm.sql(fs.readFileSync(sqlPath, 'utf8'));
};

// Lossy down: Postgres cannot remove enum values, so 'SERVICE' stays on
// professional_category and 'STANDARD' on request_tier. NOT NULL is only
// restored on the calcom columns after zero-filling SERVICE rows.
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE professional_availability
      DROP CONSTRAINT IF EXISTS no_overlapping_windows;
    ALTER TABLE professional_availability
      ADD CONSTRAINT professional_availability_professional_id_weekday_key
        UNIQUE (professional_id, weekday);
    ALTER TABLE professional_availability DROP COLUMN IF EXISTS capacity;

    UPDATE professionals SET calcom_user_id = 0 WHERE calcom_user_id IS NULL;
    UPDATE professionals SET calcom_event_type = 0 WHERE calcom_event_type IS NULL;
    ALTER TABLE professionals
      ALTER COLUMN calcom_user_id SET NOT NULL,
      ALTER COLUMN calcom_event_type SET NOT NULL,
      DROP COLUMN IF EXISTS service_flat_price,
      DROP COLUMN IF EXISTS business_name,
      DROP COLUMN IF EXISTS provider_type;
    DROP TYPE IF EXISTS provider_type;
  `);
};
