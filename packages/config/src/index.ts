import { z, type ZodSchema } from 'zod';

// Shared env-loading utility. Each service defines its own schema
// (only the vars it actually needs) and calls this to parse + validate.
export function loadEnv<T extends ZodSchema>(schema: T, env: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export { z };
