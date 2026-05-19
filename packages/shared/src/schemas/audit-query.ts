import { z } from 'zod';

const auditActionEnum = z.enum([
  'pick',
  'forced_pick',
  'pause',
  'resume',
  'skip',
  'override_rule',
  'override_cert',
  'lock_position',
  'unlock_position',
  'grant_extension',
  'admin_bid_for_member',
  'session_start',
  'session_complete',
  'members_import',
  'credentials_import',
  'positions_clone',
  'rule_book_clone',
]);

export const AuditQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    actor_id: z.coerce.number().int().nonnegative().optional(),
    actor_type: z.enum(['member', 'admin', 'system', 'ai']).optional(),
    action: auditActionEnum.optional(),
    target_id: z.string().optional(),
    bid_session_id: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: 'from must be <= to',
    path: ['from'],
  });

export type AuditQuery = z.infer<typeof AuditQuerySchema>;
