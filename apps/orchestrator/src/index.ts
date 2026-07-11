import {
  CalcomAdapter,
  DarajaAdapter,
  ChannelRouterMessagingPort,
  EmailAdapter,
  PaystackAdapter,
  TelegramAdapter,
  WaGatewayMessagingAdapter,
  WaGatewayRoomsAdapter,
} from '@marketplace/adapters';
import {
  renderTemplate,
  type MessageChannel,
  type MessagingPort,
  type PaymentsPort,
  type RegistryPort,
  type RoomsPort,
  type SchedulingPort,
} from '@marketplace/core';
import pg from 'pg';
import { loadConfig, type OrchestratorConfig } from './config.js';
import type { AppDeps } from './deps.js';
import { DevPaymentsStub, DevSchedulingStub } from './dev-stubs.js';
import { registerDevRoutes } from './dev-routes.js';
import { buildServer } from './server.js';
import { PLATFORM_DEFAULT_PRICES } from './services/pricing.js';
import { buildTimerHandlers } from './timer-handlers.js';
import { startWorkers } from './workers.js';

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

// Unconfigured providers fail loudly on use instead of pretending: quotes
// need Cal.com, payments need Paystack. Messaging alone gets a dev-log
// fallback so the outbox loop still runs locally.
function unconfigured<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === 'verifyWebhookSignature') return () => false;
      return () => Promise.reject(new Error(`${name} is not configured (missing env vars)`));
    },
  });
}

function buildDeps(cfg: OrchestratorConfig): AppDeps {
  // In development, missing providers fall back to drivable stubs (synthetic
  // availability, fake pay page) so the whole flow works without accounts.
  const dev = cfg.NODE_ENV === 'development';
  const scheduling: SchedulingPort =
    cfg.CALCOM_API_URL && cfg.CALCOM_API_KEY
      ? new CalcomAdapter({ baseUrl: cfg.CALCOM_API_URL, apiKey: cfg.CALCOM_API_KEY })
      : dev
        ? new DevSchedulingStub(pool)
        : unconfigured('CalcomAdapter');
  const mpesaConfigured =
    cfg.MPESA_CONSUMER_KEY && cfg.MPESA_CONSUMER_SECRET && cfg.MPESA_SHORTCODE && cfg.MPESA_PASSKEY && cfg.MPESA_CALLBACK_URL;
  const payments: PaymentsPort = mpesaConfigured
    ? new DarajaAdapter({
        consumerKey: cfg.MPESA_CONSUMER_KEY!,
        consumerSecret: cfg.MPESA_CONSUMER_SECRET!,
        shortcode: cfg.MPESA_SHORTCODE!,
        passkey: cfg.MPESA_PASSKEY!,
        callbackUrl: cfg.MPESA_CALLBACK_URL!,
        baseUrl: cfg.MPESA_BASE_URL,
        statusUrlBase: cfg.WEB_URL,
      })
    : cfg.PAYSTACK_SECRET_KEY
      ? new PaystackAdapter({
          secretKey: cfg.PAYSTACK_SECRET_KEY,
          ...(cfg.PAYSTACK_CALLBACK_URL ? { callbackUrl: cfg.PAYSTACK_CALLBACK_URL } : {}),
        })
      : dev
        ? new DevPaymentsStub(`http://localhost:${cfg.PORT}`)
        : unconfigured('PaystackAdapter');
  const rooms: RoomsPort = cfg.WA_GATEWAY_URL
    ? new WaGatewayRoomsAdapter({ baseUrl: cfg.WA_GATEWAY_URL, sharedSecret: cfg.INTERNAL_SHARED_SECRET })
    : unconfigured('WaGatewayRoomsAdapter');

  // Registry scraper adapters (KMPDC, LSK, ...) are built per deployment;
  // until one is wired, submissions land in manual review via the error
  // path rather than stranding anyone.
  const registry: RegistryPort = unconfigured('RegistryPort');

  return {
    pool,
    scheduling,
    payments,
    rooms,
    registry,
    pricing: { defaults: PLATFORM_DEFAULT_PRICES, overrides: {} },
    sharedSecret: config.INTERNAL_SHARED_SECRET,
    ...(cfg.MPESA_CALLBACK_TOKEN ? { mpesaCallbackToken: cfg.MPESA_CALLBACK_TOKEN } : {}),
    now: () => new Date(),
  };
}

function buildMessaging(cfg: OrchestratorConfig, log: (msg: string) => void): MessagingPort {
  const devLog: MessagingPort = {
    async send(message) {
      log(`outbox send (dev log adapter) ${message.channel} -> ${message.recipient}`);
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

const deps = buildDeps(config);
const app = buildServer(deps);
if (config.NODE_ENV === 'development') registerDevRoutes(app, deps, config.WEB_URL);

const workers = await startWorkers({
  pool,
  messaging: buildMessaging(config, (m) => app.log.info(m)),
  render: renderTemplate,
  redisUrl: config.REDIS_URL,
  timerHandlers: buildTimerHandlers(deps),
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
