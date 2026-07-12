const fs = require('node:fs');
const path = require('node:path');

const sqlPath = path.join(__dirname, 'sql', '0009-professional-claim.sql');

exports.up = (pgm) => {
  pgm.sql(fs.readFileSync(sqlPath, 'utf8'));
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_professionals_claim_status;
    DROP INDEX IF EXISTS idx_professionals_authkit_user_id;
    ALTER TABLE professionals DROP COLUMN IF EXISTS claimed_at;
    ALTER TABLE professionals DROP COLUMN IF EXISTS authkit_user_id;
    ALTER TABLE professionals DROP COLUMN IF EXISTS claim_status;
    DROP TYPE IF EXISTS claim_status;
  `);
};
