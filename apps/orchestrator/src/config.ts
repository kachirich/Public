import { loadEnv, z } from '@marketplace/config';

// Only what the scaffold needs today. Provider keys (Paystack, Cal.com,
// Resend) get added in the phase that builds their adapters.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  // Authenticates POST /internal/wa-inbound calls from apps/wa-gateway.
  INTERNAL_SHARED_SECRET: z.string().min(16),
  // Providers — optional so dev boots without accounts; when absent the
  // matching adapter is not wired and a dev log adapter covers messaging.
  CALCOM_API_URL: z.string().url().optional(),
  CALCOM_API_KEY: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_CALLBACK_URL: z.string().url().optional(),
  // Safaricom Daraja (M-Pesa STK Push) — preferred provider when set.
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_BASE_URL: z.string().url().default('https://sandbox.safaricom.co.ke'),
  // Public URL Daraja calls back; must end with the same token the webhook
  // route checks (callbacks are unsigned, the token is the auth).
  MPESA_CALLBACK_URL: z.string().url().optional(),
  MPESA_CALLBACK_TOKEN: z.string().min(16).optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  WA_GATEWAY_URL: z.string().url().optional(),
  // Where the client web app lives; dev payment stub redirects back here.
  WEB_URL: z.string().url().default('http://localhost:3002'),
});

export type OrchestratorConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  return loadEnv(schema, env);
}
