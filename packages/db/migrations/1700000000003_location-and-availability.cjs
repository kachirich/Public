const fs = require('node:fs');
const path = require('node:path');

const sqlPath = path.join(__dirname, 'sql', '0004-location-and-availability.sql');

exports.up = (pgm) => {
  pgm.sql(fs.readFileSync(sqlPath, 'utf8'));
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS professional_availability;
    ALTER TABLE professionals
      DROP COLUMN IF EXISTS location_area,
      DROP COLUMN IF EXISTS availability_consent_at;
  `);
};
