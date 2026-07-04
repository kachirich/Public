const fs = require('node:fs');
const path = require('node:path');

const sqlPath = path.join(__dirname, 'sql', '0002-professional-verification.sql');

exports.up = (pgm) => {
  pgm.sql(fs.readFileSync(sqlPath, 'utf8'));
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS professional_verifications;
    ALTER TABLE professionals DROP COLUMN IF EXISTS verification_status;
    DROP TYPE IF EXISTS verification_status;
  `);
};
