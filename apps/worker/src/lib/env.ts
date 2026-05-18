import { z } from 'zod';

export const EnvSchema = z.object({
  ENV: z.enum(['staging', 'production']),
  PORTAL_BASE_URL: z.string().url(),
  JWT_SIGNING_KEY: z.string().min(32),
  PIN_HASH: z.string().min(1),
  PORTAL_BID_READER: z.string().min(1),
  ADMIN_EMPLOYEE_IDS: z.string().optional().default(''),
});

/**
 * Returns true when `employeeId` appears in the comma-separated allow-list
 * env var ADMIN_EMPLOYEE_IDS. Whitespace around each entry is trimmed.
 * Empty/missing allow-list returns false. Plan 02 rehearsal scaffolding.
 */
export function isAdminEmployeeId(adminEmployeeIds: string, employeeId: string): boolean {
  if (!adminEmployeeIds || !employeeId) return false;
  const list = adminEmployeeIds
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(employeeId.trim());
}

export type ValidatedEnv = z.infer<typeof EnvSchema>;

export function validateEnv(env: unknown): ValidatedEnv {
  return EnvSchema.parse(env);
}
