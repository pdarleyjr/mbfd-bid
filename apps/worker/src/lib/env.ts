import { z } from 'zod';

export const EnvSchema = z.object({
  ENV: z.enum(['staging', 'production']),
  PORTAL_BASE_URL: z.string().url(),
  JWT_SIGNING_KEY: z.string().min(32),
  PIN_HASH: z.string().min(1),
  PORTAL_BID_READER: z.string().min(1),
});

export type ValidatedEnv = z.infer<typeof EnvSchema>;

export function validateEnv(env: unknown): ValidatedEnv {
  return EnvSchema.parse(env);
}
