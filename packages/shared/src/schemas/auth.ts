import { z } from 'zod';
import { RANKS } from '../constants/ranks';

export const RoleSchema = z.enum(['member', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const LoginRequestSchema = z.object({
  employee_id: z.string().trim().min(1, 'Employee ID required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  member_id: z.number().int().positive(),
  employee_id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  rank: z.enum(RANKS),
  role: RoleSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
