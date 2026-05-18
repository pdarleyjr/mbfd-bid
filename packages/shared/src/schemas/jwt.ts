import { z } from 'zod';
import { RANKS } from '../constants/ranks';
import { RoleSchema } from './auth';

export const JwtPayloadSchema = z.object({
  sub: z.number().int().positive(), // member_id
  emp: z.string(), // employee_id
  role: RoleSchema,
  rank: z.enum(RANKS),
  first_name: z.string(),
  last_name: z.string(),
  fresh_auth_at: z.number().int(), // unix seconds
  iat: z.number().int(),
  exp: z.number().int(),
});
export type JwtPayload = z.infer<typeof JwtPayloadSchema>;
