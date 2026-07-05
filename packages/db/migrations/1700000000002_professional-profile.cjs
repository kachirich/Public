const fs = require('node:fs');
const path = require('node:path');

const sqlPath = path.join(__dirname, 'sql', '0003-professional-profile.sql');

exports.up = (pgm) => {
  pgm.sql(fs.readFileSync(sqlPath, 'utf8'));
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE professionals
      DROP COLUMN IF EXISTS category,
      DROP COLUMN IF EXISTS affiliation,
      DROP COLUMN IF EXISTS title,
      DROP COLUMN IF EXISTS bio;
    DROP TYPE IF EXISTS professional_category;
  `);
};
