import { z } from 'zod';
import { RANKS } from '../constants/ranks.js';

export const RoleSchema = z.enum(['member', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const LoginRequestSchema = z.object({
  employee_id: z.string().trim().min(1, 'Employee ID required'),
  // Portal enforces actual policy; this is a UX guard to skip obvious typos.
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z
  .object({
    member_id: z.number().int().positive(),
    employee_id: z.string().min(1),
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    rank: z.enum(RANKS),
    role: RoleSchema,
  })
  .passthrough();
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
