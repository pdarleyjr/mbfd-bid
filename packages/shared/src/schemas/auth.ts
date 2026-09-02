import { z } from 'zod';
import { RANKS } from '../constants/ranks.js';

export const RoleSchema = z.enum(['member', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const LoginResponseSchema = z
  .object({
    hub_user_id: z.number().int().positive(),
    security_version: z.number().int().positive(),
    member_id: z.number().int().positive(),
    employee_id: z.string().min(1),
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    rank: z.enum(RANKS),
    role: RoleSchema,
  })
  .passthrough();
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
