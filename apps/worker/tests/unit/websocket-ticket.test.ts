import { WEBSOCKET_TICKET_AUDIENCE } from '@mbfd/shared';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { signJwt } from '../../src/lib/jwt.js';
import { verifyWebSocketTicket } from '../../src/lib/websocket-ticket.js';

const KEY = 'a'.repeat(64);

function signingKey(key: string): Uint8Array {
  const bytes = key.match(/.{1,2}/g) ?? [];
  return Uint8Array.from(bytes.map((byte) => Number.parseInt(byte, 16)));
}

async function signedTicket(overrides: Record<string, unknown> = {}): Promise<string> {
  const payload = {
    sub: '17',
    member_id: 17,
    security_version: 1,
    role: 'member',
    session_id: '01HZZ0000000000000WSTICKET',
    ...overrides,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(WEBSOCKET_TICKET_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(signingKey(KEY));
}

describe('verifyWebSocketTicket', () => {
  it('accepts only the minimal, session-scoped WebSocket ticket claims', async () => {
    const verified = await verifyWebSocketTicket(await signedTicket(), KEY);

    expect(verified).toMatchObject({
      aud: WEBSOCKET_TICKET_AUDIENCE,
      sub: 17,
      role: 'member',
      session_id: '01HZZ0000000000000WSTICKET',
    });
    expect('emp' in verified).toBe(false);
    expect('first_name' in verified).toBe(false);
  });

  it('rejects an ordinary access JWT and a ticket with a mismatched audience', async () => {
    const accessJwt = await signJwt(
      {
        sub: 17,
        emp: 'employee-id',
        role: 'member',
        rank: 'FF',
        first_name: 'Synthetic',
        last_name: 'Member',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      KEY,
      '8h',
    );
    const wrongAudience = await new SignJWT({
      sub: '17',
      member_id: 17,
      security_version: 1,
      role: 'member',
      session_id: '01HZZ0000000000000WSTICKET',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('not-a-websocket-ticket')
      .setIssuedAt()
      .setExpirationTime('60s')
      .sign(signingKey(KEY));

    await expect(verifyWebSocketTicket(accessJwt, KEY)).rejects.toThrow();
    await expect(verifyWebSocketTicket(wrongAudience, KEY)).rejects.toThrow();
  });
});
