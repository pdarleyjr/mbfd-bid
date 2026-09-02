import { z } from 'zod';
import { RoleSchema } from './auth.js';

/**
 * A short-lived, session-scoped credential for the browser WebSocket upgrade.
 * It is deliberately not an access JWT: it has no employee identifier, name,
 * rank, fresh-auth timestamp, or general API authority.
 */
export const WEBSOCKET_TICKET_AUDIENCE = 'mbfd-bid-websocket' as const;

// RFC 7519 defines `sub` as a StringOrURI.  It is the canonical Hub User
// identity; the operational identity remains explicit as member_id.
const WebSocketTicketSubjectSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,14})$/)
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger);

export const WebSocketTicketClaimsSchema = z
  .object({
    aud: z.literal(WEBSOCKET_TICKET_AUDIENCE),
    sub: WebSocketTicketSubjectSchema,
    member_id: z.number().int().positive(),
    security_version: z.number().int().positive(),
    role: RoleSchema,
    session_id: z.string().trim().min(1).max(160),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();

export type WebSocketTicketClaims = z.infer<typeof WebSocketTicketClaimsSchema>;
