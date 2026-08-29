import { z } from 'zod';
import { RoleSchema } from './auth.js';

/**
 * A short-lived, session-scoped credential for the browser WebSocket upgrade.
 * It is deliberately not an access JWT: it has no employee identifier, name,
 * rank, fresh-auth timestamp, or general API authority.
 */
export const WEBSOCKET_TICKET_AUDIENCE = 'mbfd-bid-websocket' as const;

// RFC 7519 defines `sub` as a StringOrURI. The public API keeps member IDs as
// numbers, so parse the compact wire form back to a safe integer at the trust
// boundary rather than relying on a non-standard numeric JWT subject.
const WebSocketTicketSubjectSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,14})$/)
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger);

export const WebSocketTicketClaimsSchema = z
  .object({
    aud: z.literal(WEBSOCKET_TICKET_AUDIENCE),
    sub: WebSocketTicketSubjectSchema,
    role: RoleSchema,
    session_id: z.string().trim().min(1).max(160),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();

export type WebSocketTicketClaims = z.infer<typeof WebSocketTicketClaimsSchema>;
