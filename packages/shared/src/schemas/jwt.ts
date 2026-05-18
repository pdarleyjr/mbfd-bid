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
    sub: z.number().int().positive(), // member_id
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
