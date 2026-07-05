const fs = require('node:fs');
const path = require('node:path');

const sqlPath = path.join(__dirname, 'sql', '0007-otp-login-and-location-consent.sql');

exports.up = (pgm) => {
  pgm.sql(fs.readFileSync(sqlPath, 'utf8'));
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS login_otps;
    ALTER TABLE professionals DROP COLUMN IF EXISTS location_consent_at;
  `);
};
