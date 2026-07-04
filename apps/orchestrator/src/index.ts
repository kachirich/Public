import { renderTemplate, type MessagingPort } from '@marketplace/core';
import pg from 'pg';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { startWorkers } from './workers.js';

const config = loadConfig();
const app = buildServer();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

// Placeholder until phase 5 wires the real adapters (wa-gateway, Resend):
// logs instead of sending so local runs exercise the full outbox loop.
const devLogMessaging: MessagingPort = {
  async send(message) {
    app.log.info({ channel: message.channel, recipient: message.recipient }, 'outbox send (dev log adapter)');
    return { providerMessageId: `dev-${Date.now()}` };
  },
};

const workers = await startWorkers({
  pool,
  messaging: devLogMessaging,
  render: renderTemplate,
  redisUrl: config.REDIS_URL,
});

app.addHook('onClose', async () => {
  await workers.close();
  await pool.end();
});

app
  .listen({ port: config.PORT, host: '0.0.0.0' })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
