import pg from 'pg';

const { Pool } = pg;

/**
 * PostgreSQL connection pool. This service owns its own schema — it does
 * not share the orchestrator's `clients`/`professionals` tables, though it
 * may live in the same physical database (table names don't collide).
 *
 * Accepts either DATABASE_URL (used by the rest of this monorepo, e.g. in
 * CI) or the discrete PG* vars (used for standalone deployment) — the
 * connection string wins if both are set.
 */
export const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
    })
  : new Pool({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
    });

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client:', err.message);
});

export const query = (text, params) => pool.query(text, params);

/**
 * Bootstrap the database schema. Idempotent — safe to run on every startup.
 */
export async function initializeDatabase() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS users (
      id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT          NOT NULL UNIQUE,
      password_hash TEXT          NOT NULL,
      name          TEXT,
      created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT        NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets (user_id);
    CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON password_resets (token_hash);

    -- Logout revokes the JWT server-side (by its jti) rather than relying
    -- solely on the client discarding the cookie, so a token copied before
    -- logout can't keep working until its natural expiry.
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti         TEXT        PRIMARY KEY,
      expires_at  TIMESTAMPTZ NOT NULL,
      revoked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at ON revoked_tokens (expires_at);
  `);
  console.log('[db] Schema ready');
}

/** Deletes revocation records past their token's own expiry — nothing to enforce once the JWT would fail verification anyway. */
export async function pruneExpiredRevocations() {
  await pool.query('DELETE FROM revoked_tokens WHERE expires_at < NOW()');
}
