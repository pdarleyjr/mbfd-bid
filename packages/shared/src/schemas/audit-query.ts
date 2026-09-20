import { z } from 'zod';
import { AuditActionSchema } from './audit-event.js';
import { LiveBidCommandSchema } from './bid-command.js';

const liveActions = LiveBidCommandSchema.options.map((command) => command.shape.type.value);
const auditActionEnum = z.union([
  AuditActionSchema,
  z.enum(liveActions as [(typeof liveActions)[number], ...(typeof liveActions)[number][]]),
  z.literal('mock.freeze'),
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
