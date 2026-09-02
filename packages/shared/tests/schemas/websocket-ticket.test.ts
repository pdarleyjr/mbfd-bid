import { describe, expect, it } from 'vitest';

import {
  WEBSOCKET_TICKET_AUDIENCE,
  WebSocketTicketClaimsSchema,
} from '../../src/schemas/websocket-ticket.js';

describe('WebSocketTicketClaimsSchema', () => {
  const validTicket = {
    aud: WEBSOCKET_TICKET_AUDIENCE,
    sub: '17',
    member_id: 17,
    security_version: 3,
    role: 'member',
    session_id: '01HZZ0000000000000WEBSOCKET',
    iat: 1_784_160_000,
    exp: 1_784_160_060,
  };

  it('accepts a short-lived, session-scoped identity without the session JWT PII claims', () => {
    expect(WebSocketTicketClaimsSchema.parse(validTicket)).toEqual({ ...validTicket, sub: 17 });
  });

  it('rejects a normal access-token shape and a ticket for a different audience', () => {
    expect(
      WebSocketTicketClaimsSchema.safeParse({
        ...validTicket,
        aud: 'not-a-websocket-ticket',
      }).success,
    ).toBe(false);
    expect(
      WebSocketTicketClaimsSchema.safeParse({
        sub: '17',
        emp: 'employee-id-must-not-be-needed',
        role: 'member',
        rank: 'FF',
        first_name: 'Synthetic',
        last_name: 'Member',
        fresh_auth_at: 1_784_160_000,
        iat: 1_784_160_000,
        exp: 1_784_188_800,
      }).success,
    ).toBe(false);
  });
});
