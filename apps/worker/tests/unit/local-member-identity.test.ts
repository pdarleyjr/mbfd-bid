import type { D1Database } from '@cloudflare/workers-types';
import type { JwtPayload } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';

import { withLocalMemberIdentity } from '../../src/lib/local-member-identity.js';

const claims: JwtPayload = {
  sub: 7,
  hub_user_id: 7,
  member_id: 42,
  emp: '12345',
  role: 'member',
  security_version: 3,
  rank: 'FF',
  first_name: 'Test',
  last_name: 'Member',
  fresh_auth_at: 1_700_000_000,
  authz_checked_at: 1_700_000_000,
  iat: 1_700_000_000,
  exp: 1_700_003_600,
};

describe('local Bid member identity', () => {
  function lookup(row: { id: number } | null): D1Database {
    return {
      prepare: () => ({ bind: () => ({ first: async () => row }) }),
    } as unknown as D1Database;
  }

  it('maps the exact employee match while preserving the Hub subject', async () => {
    await expect(withLocalMemberIdentity(lookup({ id: 64 }), claims)).resolves.toEqual({
      ...claims,
      member_id: 64,
    });
    await expect(withLocalMemberIdentity(lookup({ id: 42 }), claims)).resolves.toBe(claims);
  });

  it.each([null, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: Number.MAX_SAFE_INTEGER + 1 }])(
    'rejects missing or invalid exact local identity %j',
    async (row) => {
      await expect(withLocalMemberIdentity(lookup(row), claims)).rejects.toThrow(
        'local_member_identity_unresolved',
      );
    },
  );

  it('rejects a blank employee identifier when D1 exists', async () => {
    await expect(
      withLocalMemberIdentity(lookup({ id: 42 }), { ...claims, emp: ' ' }),
    ).rejects.toThrow('local_member_identity_unresolved');
  });

  it('does not treat a malformed present binding as an absent launcher binding', async () => {
    await expect(withLocalMemberIdentity({} as D1Database, claims)).rejects.toThrow(
      'local_member_identity_unresolved',
    );
  });

  it('retains the verified Hub member ID only when no D1 binding exists in a launcher harness', async () => {
    await expect(withLocalMemberIdentity(undefined as unknown as D1Database, claims)).resolves.toBe(
      claims,
    );
  });

  it('does not hide a D1 lookup failure when a binding exists', async () => {
    const db = {
      prepare() {
        throw new Error('d1 unavailable');
      },
    } as unknown as D1Database;

    await expect(withLocalMemberIdentity(db, claims)).rejects.toThrow('d1 unavailable');
  });
});
