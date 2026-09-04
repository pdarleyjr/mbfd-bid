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
};

describe('local Bid member identity', () => {
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
