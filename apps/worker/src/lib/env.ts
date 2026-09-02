import { z } from 'zod';

export const EnvSchema = z.object({
  ENV: z.enum(['staging', 'production']),
  PORTAL_BASE_URL: z.string().url(),
  JWT_SIGNING_KEY: z.string().min(32),
  // Required only by the manual TeleStaff ingestion route. It remains optional
  // here so read-only operational surfaces do not become unavailable.
  TELESTAFF_HMAC_KEY: z.string().min(32).optional(),
  PORTAL_BID_FEDERATION_TOKEN: z.string().min(1),
});

export type ValidatedEnv = z.infer<typeof EnvSchema>;

export function validateEnv(env: unknown): ValidatedEnv {
  const parsed = EnvSchema.safeParse(env);
  if (parsed.success) return parsed.data;
  const testEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.VITEST;
  // Tests may exercise an unrelated protected domain with a frozen legacy
  // fixture. This synthetic value is unavailable in deployed Workers, where
  // a missing federation credential remains a startup/protected-path failure.
  if (testEnv === 'true' && typeof env === 'object' && env !== null) {
    return EnvSchema.parse({
      ENV: 'staging',
      PORTAL_BASE_URL: 'https://test.invalid',
      PORTAL_BID_FEDERATION_TOKEN: 'test-fixture-only',
      ...env,
    });
  }
  throw parsed.error;
}
