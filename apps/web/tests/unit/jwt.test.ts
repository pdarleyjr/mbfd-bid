import { WEBSOCKET_TICKET_AUDIENCE, WebSocketTicketClaimsSchema } from '@mbfd/shared';
import { decodeJwt, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { signJwt, signWebSocketTicket, verifyJwt } from '../../lib/jwt';

const TEST_KEY = 'A'.repeat(64); // 32-byte hex placeholder

const payload = {
  sub: 555,
  hub_user_id: 555,
  member_id: 42,
  emp: '20731',
  role: 'member' as const,
  security_version: 3,
  rank: 'LT' as const,
  first_name: 'Peter',
  last_name: 'Darley',
  fresh_auth_at: Math.floor(Date.now() / 1000),
  authz_checked_at: Math.floor(Date.now() / 1000),
};

describe('signJwt / verifyJwt', () => {
  it('round-trips a valid JWT', async () => {
    const token = await signJwt(payload, TEST_KEY, '8h');
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);

    const verified = await verifyJwt(token, TEST_KEY);
    expect(verified.sub).toBe(payload.sub);
    expect(verified.emp).toBe(payload.emp);
    expect(verified.role).toBe('member');
  });

  it('rejects a token signed with a different key', async () => {
    const token = await signJwt(payload, TEST_KEY, '8h');
    await expect(verifyJwt(token, 'B'.repeat(64))).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await signJwt(payload, TEST_KEY, '-1s');
    await expect(verifyJwt(token, TEST_KEY)).rejects.toThrow();
  });

  it('serializes the canonical Hub subject while preserving explicit operational ticket identity', async () => {
    const ticket = await signWebSocketTicket(
      { sub: 555, member_id: 42, security_version: 3, role: 'member', session_id: 'session-1' },
      TEST_KEY,
    );
    const raw = decodeJwt(ticket);
    expect(raw.sub).toBe('555');
    expect(raw.aud).toBe(WEBSOCKET_TICKET_AUDIENCE);

    const key = Uint8Array.from(
      TEST_KEY.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
    );
    const { payload: verified } = await jwtVerify(ticket, key, {
      algorithms: ['HS256'],
      audience: WEBSOCKET_TICKET_AUDIENCE,
    });
    const claims = WebSocketTicketClaimsSchema.parse(verified);
    expect(claims).toMatchObject({
      sub: 555,
      member_id: 42,
      security_version: 3,
      role: 'member',
      session_id: 'session-1',
    });
    expect(claims.exp - claims.iat).toBe(60);
  });
});
