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
    // member_id; 0 is reserved for the synthetic local admin identity
    // (employee_id 'admin'), so non-negative integer is the correct bound.
    sub: z.number().int().nonnegative(),
    emp: z.string(), // employee_id
    role: RoleSchema,
    rank: z.enum(RANKS),
    first_name: z.string(),
    last_name: z.string(),
    fresh_auth_at: z.number().int(), // unix seconds
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .passthrough();
export type JwtPayload = z.infer<typeof JwtPayloadSchema>;
