import Fastify, { type FastifyInstance } from 'fastify';
import type { AppDeps } from './deps.js';
import { registerRoutes } from './routes.js';

export function buildServer(deps?: AppDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  // Keep the raw body for webhook signature verification while still
  // handing parsed JSON to the routes.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, raw, done) => {
    (req as unknown as { rawBody: string }).rawBody = raw as string;
    try {
      done(null, raw ? JSON.parse(raw as string) : {});
    } catch (err) {
      done(err as Error);
    }
  });

  app.get('/health', async () => ({ status: 'ok', service: 'orchestrator' }));

  if (deps) registerRoutes(app, deps);

  return app;
}
