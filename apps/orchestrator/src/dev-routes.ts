import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './deps.js';
import { confirmDirectMessage } from './services/direct-messages.js';
import { confirmQuotePayment } from './services/quotes.js';

// Development-only routes, registered from index.ts when NODE_ENV is
// development. The DevPaymentsStub points its authorizationUrl here so
// "Pay" completes the same confirm path a real provider webhook would,
// then returns to the right page: request status for bookings, back to
// the professional's page for paid direct messages.
export function registerDevRoutes(app: FastifyInstance, deps: AppDeps, webUrl: string): void {
  app.get<{ Params: { id: string } }>('/dev/confirm-payment/:id', async (req, reply) => {
    const { rows } = await deps.pool.query(`SELECT professional_id FROM direct_messages WHERE id = $1`, [
      req.params.id,
    ]);
    if (rows[0]) {
      await confirmDirectMessage(deps, req.params.id);
      return reply.redirect(`${webUrl}/professionals/${rows[0].professional_id}?message=sent`);
    }
    await confirmQuotePayment(deps, req.params.id, `dev-pay-${req.params.id}`);
    return reply.redirect(`${webUrl}/requests/${req.params.id}`);
  });
}
