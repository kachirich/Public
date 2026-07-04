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
});

export type OrchestratorConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  return loadEnv(schema, env);
}
