import { ChannelRouterMessagingPort, EmailAdapter, TelegramAdapter, WaGatewayMessagingAdapter } from '@marketplace/adapters';
import { renderTemplate, type MessageChannel, type MessagingPort } from '@marketplace/core';
import pg from 'pg';
import { loadConfig, type OrchestratorConfig } from './config.js';
import { buildServer } from './server.js';
import { startWorkers } from './workers.js';

const config = loadConfig();
const app = buildServer();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

// Channels with a configured provider get the real adapter; the rest fall
// back to a log-only adapter in dev so the outbox loop still runs.
function buildMessaging(cfg: OrchestratorConfig): MessagingPort {
  const devLog: MessagingPort = {
    async send(message) {
      app.log.info({ channel: message.channel, recipient: message.recipient }, 'outbox send (dev log adapter)');
      return { providerMessageId: `dev-${Date.now()}` };
    },
  };

  const routes: Partial<Record<MessageChannel, MessagingPort>> = {
    WHATSAPP: cfg.WA_GATEWAY_URL
      ? new WaGatewayMessagingAdapter({ baseUrl: cfg.WA_GATEWAY_URL, sharedSecret: cfg.INTERNAL_SHARED_SECRET })
      : devLog,
    EMAIL:
      cfg.RESEND_API_KEY && cfg.EMAIL_FROM
        ? new EmailAdapter({ apiKey: cfg.RESEND_API_KEY, from: cfg.EMAIL_FROM })
        : devLog,
    TELEGRAM: new TelegramAdapter(),
  };
  return new ChannelRouterMessagingPort(routes);
}

const workers = await startWorkers({
  pool,
  messaging: buildMessaging(config),
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
