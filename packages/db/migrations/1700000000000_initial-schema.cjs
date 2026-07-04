const fs = require('node:fs');
const path = require('node:path');

// schema.sql in the repo root is the source of truth for the data model
// (see claude-code-prompt.md). This migration applies it verbatim.
const schemaPath = path.join(__dirname, '..', '..', '..', 'schema.sql');

exports.up = (pgm) => {
  const sql = fs.readFileSync(schemaPath, 'utf8');
  pgm.sql(sql);
};

exports.down = (pgm) => {
  // Explicit drops, not `DROP SCHEMA public CASCADE` — that would also take
  // out node-pg-migrate's own bookkeeping table, which lives in `public`.
  pgm.sql(`
    DROP TABLE IF EXISTS scheduled_jobs;
    DROP TABLE IF EXISTS consult_rooms;
    DROP TABLE IF EXISTS webhook_events;
    DROP TABLE IF EXISTS inbound_messages;
    DROP TABLE IF EXISTS outbox_messages;
    DROP TABLE IF EXISTS ledger_entries;
    DROP TABLE IF EXISTS counter_offer_slots;
    DROP TABLE IF EXISTS counter_offers;
    DROP TABLE IF EXISTS request_transitions;
    DROP TABLE IF EXISTS requests;
    DROP TABLE IF EXISTS clients;
    DROP TABLE IF EXISTS professionals;

    DROP TYPE IF EXISTS actor_type;
    DROP TYPE IF EXISTS job_status;
    DROP TYPE IF EXISTS outbox_status;
    DROP TYPE IF EXISTS message_channel;
    DROP TYPE IF EXISTS ledger_entry_type;
    DROP TYPE IF EXISTS request_state;
    DROP TYPE IF EXISTS request_tier;
  `);
};
