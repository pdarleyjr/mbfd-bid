import { z } from 'zod';
import { RANKS } from '../constants/ranks.js';
import { RoleSchema } from './auth.js';

/**
 * Validates a *verified* JWT payload as returned by `jose.jwtVerify`.
 *
 * `iat` and `exp` are added by `SignJWT.setIssuedAt()` / `.setExpirationTime()`.
 * To type the INPUT to a sign helper, use `Omit<JwtPayload, 'iat' | 'exp'>`.
 */
export const JwtPayloadSchema = z
  .object({
    // Canonical Hub User identity.  Operational/member operations must use
    // member_id explicitly; it is intentionally never inferred from sub.
    sub: z.number().int().positive(),
    hub_user_id: z.number().int().positive(),
    member_id: z.number().int().positive(),
    emp: z.string(), // employee_id
    role: RoleSchema,
    security_version: z.number().int().positive(),
    rank: z.enum(RANKS),
    first_name: z.string(),
    last_name: z.string(),
    fresh_auth_at: z.number().int(), // unix seconds
    authz_checked_at: z.number().int(), // unix seconds, Hub revalidation
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .passthrough();
export type JwtPayload = z.infer<typeof JwtPayloadSchema>;

/**
 * Isolated fixture decoder for repository tests that predate the canonical
 * Hub subject migration. Production decoders must never use this schema.
 */
export const LegacyFixtureJwtPayloadSchema = z.object({
  sub: z.number().int().nonnegative(),
  emp: z.string(),
  role: RoleSchema,
  rank: z.enum(RANKS),
  first_name: z.string(),
  last_name: z.string(),
  fresh_auth_at: z.number().int(),
  iat: z.number().int(),
  exp: z.number().int(),
});
