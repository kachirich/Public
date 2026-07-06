import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { RequestState } from '../state/transitions.js';

const SCHEMA_PATH = fileURLToPath(new URL('../../../../schema.sql', import.meta.url));
const MIGRATIONS_SQL_DIR = new URL('../../../db/migrations/sql/', import.meta.url);
const EXTRA_MIGRATIONS = [
  '0002-professional-verification.sql',
  '0003-professional-profile.sql',
  '0004-location-and-availability.sql',
  '0005-direct-messages.sql',
  '0006-availability-flag.sql',
  '0007-otp-login-and-location-consent.sql',
  '0008-booking-source.sql',
  '0009-professional-claim.sql',
  '0009-service-providers.sql',
];

export function testPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set to run @marketplace/core DB tests');
  return new pg.Pool({ connectionString: url, max: 10 });
}

export async function ensureSchema(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query(`SELECT to_regclass('public.requests') AS t`);
  if (!rows[0].t) {
    await pool.query(readFileSync(SCHEMA_PATH, 'utf8'));
  }
  // Post-schema.sql migrations (CI applies them via node-pg-migrate; local
  // test databases get them here).
  const { rows: verif } = await pool.query(`SELECT to_regclass('public.professional_verifications') AS t`);
  if (!verif[0].t) {
    for (const file of EXTRA_MIGRATIONS) {
      await pool.query(readFileSync(fileURLToPath(new URL(file, MIGRATIONS_SQL_DIR)), 'utf8'));
    }
    return;
  }
  // Databases migrated before 0009 (e.g. via an older `pnpm migrate:up`)
  // pick up the migrations here.
  const { rows: claim } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'professionals' AND column_name = 'claim_status'`,
  );
  const { rows: pt } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'professionals' AND column_name = 'provider_type'`,
  );
  const { rows: avail } = await pool.query(`SELECT to_regclass('public.professional_availability') AS t`);
  if (claim.length === 0 && avail[0].t) {
    await pool.query(readFileSync(fileURLToPath(new URL('0009-professional-claim.sql', MIGRATIONS_SQL_DIR)), 'utf8'));
  }
  if (pt.length === 0 && avail[0].t) {
    await pool.query(readFileSync(fileURLToPath(new URL('0009-service-providers.sql', MIGRATIONS_SQL_DIR)), 'utf8'));
  }
}

export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query(`
    TRUNCATE scheduled_jobs, consult_rooms, webhook_events, inbound_messages,
             outbox_messages, ledger_entries, counter_offer_slots, counter_offers,
             request_transitions, requests, clients,
             professional_verifications, login_otps, direct_messages,
             professional_availability, professionals
    RESTART IDENTITY CASCADE
  `);
}

export interface SeededRequest {
  requestId: string;
  clientId: string;
  professionalId: string;
}

export async function seedRequest(
  pool: pg.Pool,
  state: RequestState,
  overrides: Partial<{
    sessionStart: Date;
    durationMinutes: number;
    cardExpiresAt: Date | null;
    priceGross: string;
    platformFee: string;
    payoutNet: string;
    clientEmail: string | null;
    clientPhone: string | null;
  }> = {},
): Promise<SeededRequest> {
  const unique = Math.random().toString(36).slice(2, 10);
  const prof = await pool.query(
    `INSERT INTO professionals (display_name, whatsapp_e164, calcom_user_id, calcom_event_type, payout_method)
     VALUES ('Dr Test', $1, 1, 1, '{"type":"MPESA","msisdn":"+254700000001"}') RETURNING id`,
    [`+2547${unique.slice(0, 8)}`],
  );
  const client = await pool.query(
    `INSERT INTO clients (display_name, phone_e164, email) VALUES ('Client Test', $1, $2) RETURNING id`,
    [
      overrides.clientPhone === null ? null : (overrides.clientPhone ?? `+2541${unique.slice(0, 8)}`),
      overrides.clientEmail === null ? null : (overrides.clientEmail ?? `client-${unique}@example.com`),
    ],
  );
  const req = await pool.query(
    `INSERT INTO requests (ref_code, client_id, professional_id, tier, state, session_start,
                           duration_minutes, brief, price_gross, platform_fee, payout_net, card_expires_at)
     VALUES ($1, $2, $3, 'OFF_DUTY', $4, $5, $6, 'test brief', $7, $8, $9, $10) RETURNING id`,
    [
      `R${unique.toUpperCase().slice(0, 4)}`,
      client.rows[0].id,
      prof.rows[0].id,
      state,
      overrides.sessionStart ?? new Date(Date.now() + 24 * 3600_000),
      overrides.durationMinutes ?? 60,
      overrides.priceGross ?? '1000.00',
      overrides.platformFee ?? '150.00',
      overrides.payoutNet ?? '850.00',
      overrides.cardExpiresAt === undefined ? new Date(Date.now() + 4 * 3600_000) : overrides.cardExpiresAt,
    ],
  );
  return { requestId: req.rows[0].id, clientId: client.rows[0].id, professionalId: prof.rows[0].id };
}
