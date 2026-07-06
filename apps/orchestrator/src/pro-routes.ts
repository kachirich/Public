import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './deps.js';
import { registerServiceProvider, startProLogin, verifyProLogin } from './services/pro-login.js';

// Provider portal endpoints. PROFESSIONAL rows only get in once VERIFIED —
// the same hard gate the booking path enforces. SERVICE providers register
// lightly (no registry verification) and get in while active.
//
// Auth model (v1): the portal proves control of the WhatsApp number via the
// existing OTP machinery in production; in development, knowing the number
// of a verified professional signs you in. Every mutating route re-checks
// the professional exists and is verified or is a service provider.
//
// claim_status is a second, orthogonal gate on top of verification_status:
// a professional/provider can be bookable while still UNCLAIMED or
// HOSPITAL_VERIFIED (nobody has linked an AuthKit account to the row yet).
// Login/OTP-verify use findVerified — a professional/provider must be
// findable and OTP-able before they can claim their row. Every other
// mutating/reading portal route uses findActivated, which additionally
// requires claim_status = 'FULLY_ACTIVATED', so an unclaimed profile
// cannot be read or mutated through the portal API no matter what the web
// app does — this is enforced here, not just at the frontend gate.

interface AvailabilitySlotBody {
  weekday: number; // 0 = Sunday
  startMinute: number;
  endMinute: number;
  capacity?: number; // SERVICE only; PROFESSIONAL windows are always capacity 1
}

const PROFESSIONAL_CATEGORIES = new Set(['DOCTOR', 'LECTURER', 'LAWYER', 'ACCOUNTANT', 'ENGINEER', 'THERAPIST']);

interface ApplyBody {
  displayName: string;
  whatsapp: string;
  email?: string;
  category: string;
  affiliation?: string;
  title?: string;
  bio?: string;
  authkitUserId: string;
  authkitEmail: string;
}

const PORTAL_COLUMNS = `id, display_name, business_name, provider_type, category, affiliation, title, location_area,
            availability_consent_at, is_available,
            claim_status AS "claimStatus", authkit_user_id AS "authkitUserId",
            verification_status AS "verificationStatus"`;

async function findVerified(deps: AppDeps, whereSql: string, param: string) {
  const { rows } = await deps.pool.query(
    `SELECT ${PORTAL_COLUMNS}
     FROM professionals
     WHERE ${whereSql} AND is_active
       AND (provider_type = 'SERVICE' OR verification_status = 'VERIFIED')`,
    [param],
  );
  return rows[0];
}

async function findActivated(deps: AppDeps, whereSql: string, param: string) {
  const { rows } = await deps.pool.query(
    `SELECT ${PORTAL_COLUMNS}
     FROM professionals
     WHERE ${whereSql} AND is_active
       AND (provider_type = 'SERVICE' OR verification_status = 'VERIFIED')
       AND claim_status = 'FULLY_ACTIVATED'`,
    [param],
  );
  return rows[0];
}

// Unlike findVerified/findActivated, this doesn't gate on verification_status
// at all — it backs the portal's own "what state is my row in" read (GET
// /pro/:id), which self-applied professionals need to hit while still
// PENDING_VERIFICATION so apps/web can show them a pending-review screen
// instead of a 404. Ownership is checked one layer up in apps/web by
// comparing the caller's AuthKit id against authkitUserId.
async function findPortalRow(deps: AppDeps, whereSql: string, param: string) {
  const { rows } = await deps.pool.query(
    `SELECT ${PORTAL_COLUMNS}
     FROM professionals
     WHERE ${whereSql} AND is_active`,
    [param],
  );
  return rows[0];
}

export function registerProRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Self-application: someone with no existing professionals row at all
  // registers directly, distinct from claiming a pre-existing one. The
  // caller must already hold an AuthKit session (apps/web's middleware
  // gates /pro/apply) and the new row is bound to that account immediately
  // — claim_status is FULLY_ACTIVATED from creation, there's nothing to
  // claim later. verification_status keeps its table default of
  // PENDING_VERIFICATION, so the new professional is invisible on the
  // public listing until an admin runs them through the usual
  // registry+OTP verification pipeline. calcom_user_id/calcom_event_type
  // are placeholders (0) — every existing row in this codebase has those
  // provisioned out of band before going live, and nothing reads them
  // until verification_status reaches VERIFIED (see services/quotes.ts).
  app.post<{ Body: ApplyBody }>('/pro/apply', async (req, reply) => {
    const { displayName, whatsapp, email, category, affiliation, title, bio, authkitUserId, authkitEmail } = req.body ?? ({} as ApplyBody);
    if (!displayName?.trim() || !whatsapp?.trim() || !category || !authkitUserId || !authkitEmail) {
      return reply.code(400).send({ error: 'displayName, whatsapp, category, authkitUserId, and authkitEmail are required' });
    }
    if (!PROFESSIONAL_CATEGORIES.has(category)) {
      return reply.code(400).send({ error: 'invalid category' });
    }

    try {
      const { rows } = await deps.pool.query(
        `INSERT INTO professionals (
           display_name, whatsapp_e164, email, category, affiliation, title, bio,
           calcom_user_id, calcom_event_type, payout_method,
           claim_status, authkit_user_id, claimed_at
         ) VALUES ($1, $2, $3, $4::professional_category, $5, $6, $7, 0, 0, $8, 'FULLY_ACTIVATED', $9, now())
         RETURNING id, claim_status AS "claimStatus", authkit_user_id AS "authkitUserId",
                   verification_status AS "verificationStatus"`,
        [
          displayName.trim(),
          whatsapp.trim(),
          email?.trim() || null,
          category,
          affiliation?.trim() || null,
          title?.trim() || null,
          bio?.trim() || null,
          JSON.stringify({ type: 'MPESA', msisdn: whatsapp.trim() }),
          authkitUserId,
        ],
      );
      return reply.code(201).send({ professional: rows[0] });
    } catch (err) {
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23505') {
        if (pgErr.constraint === 'idx_professionals_authkit_user_id') {
          return reply.code(409).send({ error: 'this account has already applied for or claimed a professional profile' });
        }
        return reply.code(409).send({ error: 'a professional is already registered with this WhatsApp number' });
      }
      throw err;
    }
  });

  // Light self-registration for SERVICE providers (salons, garages, field
  // businesses): name + business + WhatsApp. No registry verification —
  // the returned OTP challenge proves number ownership, and the provider is
  // bookable immediately. Admins can deactivate bad actors.
  app.post<{ Body: { displayName: string; businessName: string; whatsapp: string; flatPrice?: string } }>(
    '/pro/register',
    async (req, reply) => {
      const displayName = req.body?.displayName?.trim();
      const businessName = req.body?.businessName?.trim();
      const whatsapp = req.body?.whatsapp?.trim();
      const flatPrice = req.body?.flatPrice?.trim();
      if (!displayName || !businessName || !whatsapp) {
        return reply.code(400).send({ error: 'displayName, businessName and whatsapp are required' });
      }
      if (!/^\+\d{9,15}$/.test(whatsapp)) {
        return reply.code(422).send({ error: 'whatsapp must be in international format, e.g. +2547XXXXXXXX' });
      }
      if (flatPrice !== undefined && flatPrice !== '' && !/^\d{1,10}(\.\d{1,2})?$/.test(flatPrice)) {
        return reply.code(422).send({ error: 'flatPrice must be an amount like 800 or 800.00' });
      }
      const result = await registerServiceProvider(
        deps,
        { displayName, businessName, whatsapp, ...(flatPrice ? { flatPrice } : {}) },
        process.env.NODE_ENV !== 'production',
      );
      return reply.code(201).send(result);
    },
  );

  // Two-step OTP login: the code lands on the professional's WhatsApp,
  // proving control of the number before any session exists. Uses
  // findVerified (not findActivated) — an unclaimed professional must
  // still be able to log in and OTP-verify, since that's the prerequisite
  // for claiming the row in the first place.
  app.post<{ Body: { whatsapp: string } }>('/pro/login', async (req, reply) => {
    const whatsapp = req.body?.whatsapp?.trim();
    if (!whatsapp) return reply.code(400).send({ error: 'whatsapp is required' });
    return startProLogin(deps, whatsapp, process.env.NODE_ENV !== 'production');
  });

  app.post<{ Body: { challengeId: string; code: string } }>('/pro/login/verify', async (req, reply) => {
    const { challengeId, code } = req.body ?? {};
    if (!challengeId || !code) return reply.code(400).send({ error: 'challengeId and code are required' });
    const { professionalId } = await verifyProLogin(deps, challengeId, code);
    const pro = await findVerified(deps, 'id = $1', professionalId);
    if (!pro) return reply.code(404).send({ error: 'professional not found' });
    return { professional: pro };
  });

  // Portal view of a professional, including claim_status/authkit_user_id/
  // verification_status — deliberately separate from the public GET
  // /professionals/:id (routes.ts), which never exposes those fields. Used
  // by the claim screen, the pending-verification screen, and the dashboard
  // to figure out what to show and to verify the signed-in AuthKit account
  // actually owns this profile. Uses findPortalRow, not findVerified —
  // self-applied professionals need this to work while still
  // PENDING_VERIFICATION, before verification even starts.
  app.get<{ Params: { id: string } }>('/pro/:id', async (req, reply) => {
    const pro = await findPortalRow(deps, 'id = $1', req.params.id);
    if (!pro) return reply.code(404).send({ error: 'professional not found' });
    return { professional: pro };
  });

  // Claim: links this professional row to an AuthKit account, transitioning
  // UNCLAIMED/HOSPITAL_VERIFIED -> FULLY_ACTIVATED. Uses findVerified (not
  // findActivated) since the whole point is to activate a not-yet-activated
  // row. Idempotent for the same account; conflicts (row already claimed by
  // someone else, or this account already claimed a different row) return
  // 409 rather than silently overwriting.
  app.post<{ Params: { id: string }; Body: { authkitUserId: string; authkitEmail: string } }>(
    '/pro/:id/claim',
    async (req, reply) => {
      const { authkitUserId, authkitEmail } = req.body ?? {};
      if (!authkitUserId || !authkitEmail) {
        return reply.code(400).send({ error: 'authkitUserId and authkitEmail are required' });
      }

      const pro = await findVerified(deps, 'id = $1', req.params.id);
      if (!pro) return reply.code(404).send({ error: 'professional not found' });

      if (pro.claimStatus === 'FULLY_ACTIVATED') {
        if (pro.authkitUserId === authkitUserId) return { professional: pro };
        return reply.code(409).send({ error: 'this profile has already been claimed' });
      }

      try {
        const { rows } = await deps.pool.query(
          `UPDATE professionals
           SET claim_status = 'FULLY_ACTIVATED', authkit_user_id = $2, claimed_at = now()
           WHERE id = $1
           RETURNING id, claim_status AS "claimStatus", authkit_user_id AS "authkitUserId",
                     verification_status AS "verificationStatus"`,
          [req.params.id, authkitUserId],
        );
        return { professional: rows[0] };
      } catch (err) {
        // unique_violation on idx_professionals_authkit_user_id: this
        // AuthKit account already claimed a different profile.
        if ((err as { code?: string }).code === '23505') {
          return reply.code(409).send({ error: 'this account has already claimed a different profile' });
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { id: string } }>('/pro/:id/availability', async (req, reply) => {
    const pro = await findActivated(deps, 'id = $1', req.params.id);
    if (!pro) return reply.code(404).send({ error: 'professional not found' });
    const { rows } = await deps.pool.query(
      `SELECT weekday, start_minute AS "startMinute", end_minute AS "endMinute", capacity
       FROM professional_availability WHERE professional_id = $1 ORDER BY weekday, start_minute`,
      [req.params.id],
    );
    return { consentedAt: pro.availability_consent_at, slots: rows };
  });

  app.put<{ Params: { id: string }; Body: { consent: boolean; slots: AvailabilitySlotBody[] } }>(
    '/pro/:id/availability',
    async (req, reply) => {
      const pro = await findActivated(deps, 'id = $1', req.params.id);
      if (!pro) return reply.code(404).send({ error: 'professional not found' });
      const { consent, slots } = req.body ?? {};
      if (!consent) return reply.code(422).send({ error: 'availability sharing requires consent' });
      if (!Array.isArray(slots)) return reply.code(400).send({ error: 'slots array is required' });
      for (const s of slots) {
        if (
          !Number.isInteger(s.weekday) || s.weekday < 0 || s.weekday > 6 ||
          !Number.isInteger(s.startMinute) || !Number.isInteger(s.endMinute) ||
          s.startMinute < 0 || s.endMinute > 1440 || s.endMinute <= s.startMinute ||
          (s.capacity !== undefined && (!Number.isInteger(s.capacity) || s.capacity < 1 || s.capacity > 1000))
        ) {
          return reply.code(400).send({ error: 'each slot needs weekday 0-6, startMinute < endMinute within the day, and capacity >= 1' });
        }
      }
      // Windows on the same weekday must not overlap (the DB exclusion
      // constraint is the backstop): occupancy counting assumes exactly one
      // covering window per instant.
      const byDay = [...slots].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
      for (let i = 1; i < byDay.length; i++) {
        if (byDay[i]!.weekday === byDay[i - 1]!.weekday && byDay[i]!.startMinute < byDay[i - 1]!.endMinute) {
          return reply.code(422).send({ error: 'windows on the same day must not overlap' });
        }
      }

      const client = await deps.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM professional_availability WHERE professional_id = $1`, [req.params.id]);
        for (const s of slots) {
          // PROFESSIONAL windows are strictly single-capacity — the strict
          // slot semantics are untouched by the SERVICE capacity model.
          const capacity = pro.provider_type === 'SERVICE' ? (s.capacity ?? 1) : 1;
          await client.query(
            `INSERT INTO professional_availability (professional_id, weekday, start_minute, end_minute, capacity)
             VALUES ($1, $2, $3, $4, $5)`,
            [req.params.id, s.weekday, s.startMinute, s.endMinute, capacity],
          );
        }
        await client.query(
          `UPDATE professionals SET availability_consent_at = COALESCE(availability_consent_at, now()) WHERE id = $1`,
          [req.params.id],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return { saved: true, slots: slots.length };
    },
  );

  // Available / not available: the professional's own pause switch.
  app.put<{ Params: { id: string }; Body: { available: boolean } }>('/pro/:id/status', async (req, reply) => {
    const pro = await findActivated(deps, 'id = $1', req.params.id);
    if (!pro) return reply.code(404).send({ error: 'professional not found' });
    if (typeof req.body?.available !== 'boolean') return reply.code(400).send({ error: 'available must be a boolean' });
    await deps.pool.query(`UPDATE professionals SET is_available = $2 WHERE id = $1`, [req.params.id, req.body.available]);
    return { saved: true, available: req.body.available };
  });

  // Location privacy: area shows to clients only while consent stands.
  app.put<{ Params: { id: string }; Body: { showLocation: boolean } }>('/pro/:id/privacy', async (req, reply) => {
    const pro = await findActivated(deps, 'id = $1', req.params.id);
    if (!pro) return reply.code(404).send({ error: 'professional not found' });
    if (typeof req.body?.showLocation !== 'boolean') {
      return reply.code(400).send({ error: 'showLocation must be a boolean' });
    }
    await deps.pool.query(
      `UPDATE professionals SET location_consent_at = CASE WHEN $2 THEN now() END WHERE id = $1`,
      [req.params.id, req.body.showLocation],
    );
    return { saved: true, showLocation: req.body.showLocation };
  });

  // Message & spam settings: the fee that gates paid direct messages, and
  // the note appended to every forwarded message.
  app.get<{ Params: { id: string } }>('/pro/:id/settings', async (req, reply) => {
    const pro = await findActivated(deps, 'id = $1', req.params.id);
    if (!pro) return reply.code(404).send({ error: 'professional not found' });
    const { rows } = await deps.pool.query(
      `SELECT direct_message_fee AS "directMessageFee", dm_note AS "dmNote",
              (location_consent_at IS NOT NULL) AS "showLocation", location_area AS "locationArea"
       FROM professionals WHERE id = $1`,
      [req.params.id],
    );
    return rows[0];
  });

  app.put<{ Params: { id: string }; Body: { directMessageFee: string; dmNote?: string } }>(
    '/pro/:id/settings',
    async (req, reply) => {
      const pro = await findActivated(deps, 'id = $1', req.params.id);
      if (!pro) return reply.code(404).send({ error: 'professional not found' });
      const fee = Number(req.body?.directMessageFee);
      if (!Number.isFinite(fee) || fee < 0 || fee > 100_000) {
        return reply.code(400).send({ error: 'directMessageFee must be a number between 0 and 100000' });
      }
      const dmNote = req.body?.dmNote?.trim() || null;
      if (dmNote && dmNote.length > 300) return reply.code(422).send({ error: 'keep the note under 300 characters' });
      await deps.pool.query(
        `UPDATE professionals SET direct_message_fee = $2, dm_note = $3 WHERE id = $1`,
        [req.params.id, fee.toFixed(2), dmNote],
      );
      return { saved: true };
    },
  );

  app.get<{ Params: { id: string } }>('/pro/:id/sessions', async (req, reply) => {
    const pro = await findActivated(deps, 'id = $1', req.params.id);
    if (!pro) return reply.code(404).send({ error: 'professional not found' });
    const { rows } = await deps.pool.query(
      `SELECT r.id, r.ref_code, r.state, r.tier, r.session_start, r.duration_minutes,
              r.currency, r.payout_net, r.source, c.display_name AS client_name
       FROM requests r JOIN clients c ON c.id = r.client_id
       WHERE r.professional_id = $1
         AND r.state IN ('HELD', 'COUNTER_OFFERED', 'ACCEPTED', 'IN_SESSION')
       ORDER BY r.session_start`,
      [req.params.id],
    );
    return { sessions: rows };
  });
}
