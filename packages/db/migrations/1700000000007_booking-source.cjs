const fs = require('node:fs');
const path = require('node:path');

const sqlPath = path.join(__dirname, 'sql', '0008-booking-source.sql');

exports.up = (pgm) => {
  pgm.sql(fs.readFileSync(sqlPath, 'utf8'));
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE requests        DROP COLUMN IF EXISTS source;
    ALTER TABLE direct_messages DROP COLUMN IF EXISTS source;
  `);
};
