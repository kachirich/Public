import { loadEnv, z } from '@marketplace/config';

// No business logic lives here — just enough to reach the orchestrator
// and authenticate the internal webhook call.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  ORCHESTRATOR_BASE_URL: z.string().url(),
  INTERNAL_SHARED_SECRET: z.string().min(16),
});

export type WaGatewayConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WaGatewayConfig {
  return loadEnv(schema, env);
}
