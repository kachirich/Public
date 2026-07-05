import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './deps.js';
import { startProLogin, verifyProLogin } from './services/pro-login.js';

// Professional portal endpoints. Only VERIFIED professionals get in — the
// same hard gate the booking path enforces.
//
// Auth model (v1): the portal proves control of the WhatsApp number via the
// existing OTP machinery in production; in development, knowing the number
// of a verified professional signs you in. Every mutating route re-checks
// the professional exists and is verified.

interface AvailabilitySlotBody {
  weekday: number; // 0 = Sunday
  startMinute: number;
  endMinute: number;
}

async function findVerified(deps: AppDeps, whereSql: string, param: string) {
  const { rows } = await deps.pool.query(
    `SELECT id, display_name, category, affiliation, title, location_area,
            availability_consent_at, is_available
     FROM professionals
     WHERE ${whereSql} AND is_active AND verification_status = 'VERIFIED'`,
    [param],
  );
  return rows[0];
}

export function registerProRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Two-step OTP login: the code lands on the professional's WhatsApp,
  // proving control of the number before any session exists.
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

  app.get<{ Params: { id: string } }>('/pro/:id/availability', async (req, reply) => {
    const pro = await findVerified(deps, 'id = $1', req.params.id);
    if (!pro) return reply.code(404).send({ error: 'professional not found' });
    const { rows } = await deps.pool.query(
      `SELECT weekday, start_minute AS "startMinute", end_minute AS "endMinute"
       FROM professional_availability WHERE professional_id = $1 ORDER BY weekday`,
      [req.params.id],
    );
    return { consentedAt: pro.availability_consent_at, slots: rows };
  });

  app.put<{ Params: { id: string }; Body: { consent: boolean; slots: AvailabilitySlotBody[] } }>(
    '/pro/:id/availability',
    async (req, reply) => {
      const pro = await findVerified(deps, 'id = $1', req.params.id);
      if (!pro) return reply.code(404).send({ error: 'professional not found' });
      const { consent, slots } = req.body ?? {};
      if (!consent) return reply.code(422).send({ error: 'availability sharing requires consent' });
      if (!Array.isArray(slots)) return reply.code(400).send({ error: 'slots array is required' });
      for (const s of slots) {
        if (
          !Number.isInteger(s.weekday) || s.weekday < 0 || s.weekday > 6 ||
          !Number.isInteger(s.startMinute) || !Number.isInteger(s.endMinute) ||
          s.startMinute < 0 || s.endMinute > 1440 || s.endMinute <= s.startMinute
        ) {
          return reply.code(400).send({ error: 'each slot needs weekday 0-6 and startMinute < endMinute within the day' });
        }
      }

      const client = await deps.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM professional_availability WHERE professional_id = $1`, [req.params.id]);
        for (const s of slots) {
          await client.query(
            `INSERT INTO professional_availability (professional_id, weekday, start_minute, end_minute)
             VALUES ($1, $2, $3, $4)`,
            [req.params.id, s.weekday, s.startMinute, s.endMinute],
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
    const pro = await findVerified(deps, 'id = $1', req.params.id);
    if (!pro) return reply.code(404).send({ error: 'professional not found' });
    if (typeof req.body?.available !== 'boolean') return reply.code(400).send({ error: 'available must be a boolean' });
    await deps.pool.query(`UPDATE professionals SET is_available = $2 WHERE id = $1`, [req.params.id, req.body.available]);
    return { saved: true, available: req.body.available };
  });

  // Location privacy: area shows to clients only while consent stands.
  app.put<{ Params: { id: string }; Body: { showLocation: boolean } }>('/pro/:id/privacy', async (req, reply) => {
    const pro = await findVerified(deps, 'id = $1', req.params.id);
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
    const pro = await findVerified(deps, 'id = $1', req.params.id);
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
      const pro = await findVerified(deps, 'id = $1', req.params.id);
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
    const pro = await findVerified(deps, 'id = $1', req.params.id);
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
