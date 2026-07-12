import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { initializeDatabase, pruneExpiredRevocations } from './db.js';
import authRouter from './auth.js';
import { errorHandler } from './middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function buildApp() {
  const app = express();

  // Behind a reverse proxy/load balancer in production, so rate limiting
  // and secure-cookie decisions see the real client IP/protocol.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        const allowed = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
        // Same-origin requests (no Origin header, e.g. curl or the bundled
        // frontend loaded from this same host) are always allowed.
        if (!origin || allowed.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRouter);

  // Bundled login UI — served statically, same origin as the API so no CORS
  // preflight is needed for the browser's fetch() calls.
  app.use(express.static(path.join(__dirname, 'public')));

  app.use(errorHandler);
  return app;
}

async function start() {
  await initializeDatabase();
  const app = buildApp();
  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    console.log(`[authkit-service] Listening on port ${port} (${process.env.NODE_ENV || 'development'})`);
  });

  // Sweep expired revocation records hourly so the table doesn't grow
  // unbounded — once a token's own exp has passed, verifySession() already
  // rejects it, so there's nothing left to enforce.
  setInterval(() => {
    pruneExpiredRevocations().catch((err) => console.error('[authkit-service] Prune failed:', err.message));
  }, 60 * 60 * 1000);
}

// Only auto-start when run directly (`node server.js`), not when imported
// by tests via buildApp().
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().catch((err) => {
    console.error('[authkit-service] Failed to start:', err);
    process.exit(1);
  });
}
