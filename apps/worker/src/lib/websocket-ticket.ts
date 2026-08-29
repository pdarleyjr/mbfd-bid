import {
  WEBSOCKET_TICKET_AUDIENCE,
  type WebSocketTicketClaims,
  WebSocketTicketClaimsSchema,
} from '@mbfd/shared';
import { jwtVerify } from 'jose';

function keyToUint8(key: string): Uint8Array {
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    const bytes = key.match(/.{1,2}/g) ?? [];
    return Uint8Array.from(bytes.map((byte) => Number.parseInt(byte, 16)));
  }
  return new TextEncoder().encode(key);
}

/**
 * Verifies the browser-only ticket used during a WebSocket upgrade. It is
 * deliberately separate from `verifyJwt`: a normal API access JWT cannot be
 * replayed as a browser WebSocket subprotocol credential, and the ticket
 * carries only a session-scoped identity.
 */
export async function verifyWebSocketTicket(
  ticket: string,
  signingKey: string,
): Promise<WebSocketTicketClaims> {
  const { payload } = await jwtVerify(ticket, keyToUint8(signingKey), {
    algorithms: ['HS256'],
    audience: WEBSOCKET_TICKET_AUDIENCE,
  });
  return WebSocketTicketClaimsSchema.parse(payload);
}
