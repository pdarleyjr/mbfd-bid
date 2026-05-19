import bcrypt from 'bcryptjs';
import { z } from 'zod';

export const LOCAL_ADMIN_USERNAME = 'admin';

export const EnvSchema = z.object({
  ENV: z.enum(['staging', 'production']),
  PORTAL_BASE_URL: z.string().url(),
  JWT_SIGNING_KEY: z.string().min(32),
  PIN_HASH: z.string().min(1),
  PORTAL_BID_READER: z.string().min(1),
  // Optional in dev; required in staging/production for the admin login to
  // succeed. The username is the constant LOCAL_ADMIN_USERNAME above; this
  // secret is the bcrypt hash of the shared admin password.
  LOCAL_ADMIN_PASSWORD_HASH: z.string().optional().default(''),
  // Plan 06 — AI integration. All Anthropic traffic flows through the
  // Cloudflare AI Gateway, so the SDK baseURL points at the gateway and
  // ANTHROPIC_API_KEY is forwarded by the gateway. AI_BUDGET_CAP_CENTS is
  // a hard ceiling on per-day spend across all advisory endpoints.
  CF_AI_GATEWAY_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), 'Gateway URL must be https'),
  ANTHROPIC_API_KEY: z.string().min(1),
  AI_BUDGET_CAP_CENTS: z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'string' ? Number(v) : v))
    .pipe(z.number().int().nonnegative())
    .default(2500),
  AI_FEATURE_FLAG_KEY: z.string().default('ai_advisory_enabled'),
});

export type ValidatedEnv = z.infer<typeof EnvSchema>;

export function validateEnv(env: unknown): ValidatedEnv {
  return EnvSchema.parse(env);
}

/**
 * Verifies a plain-text password against the LOCAL_ADMIN_PASSWORD_HASH bcrypt
 * digest. Returns false when the hash secret is missing or the password is
 * empty (prevents accidental "anyone with no secret set can log in" footgun).
 *
 * Plan 02 rehearsal scaffolding; Plan 05 admin console replaces this.
 */
export function verifyLocalAdminPassword(passwordHash: string, candidate: string): boolean {
  if (!passwordHash || !candidate) return false;
  try {
    return bcrypt.compareSync(candidate, passwordHash);
  } catch {
    return false;
  }
}
