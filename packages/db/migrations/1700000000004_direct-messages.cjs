const fs = require('node:fs');
const path = require('node:path');

const sqlPath = path.join(__dirname, 'sql', '0005-direct-messages.sql');

exports.up = (pgm) => {
  pgm.sql(fs.readFileSync(sqlPath, 'utf8'));
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS direct_messages;
    ALTER TABLE professionals
      DROP COLUMN IF EXISTS direct_message_fee,
      DROP COLUMN IF EXISTS dm_note;
  `);
};
