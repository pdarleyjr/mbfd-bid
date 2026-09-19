import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { seedSyntheticOfficialCompletion } from './helpers/synthetic-official-completion.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('read-only canonical session results and completion', () => {
  let h: TestD1;
  let token: string;
  let memberToken: string;
  let doGet: ReturnType<typeof vi.fn>;
  const sessionId = 'annual-real-2027';
  const request = (endpoint: string, id = sessionId, authorization: string | null = token) =>
    app.fetch(
      new Request(`http://x/api/admin/bid-session/${id}/${endpoint}`, {
        headers: authorization === null ? {} : { Authorization: `Bearer ${authorization}` },
      }),
      h.env,
    );

  beforeEach(async () => {
    h = await setupTestD1();
    const claims = {
      sub: 0,
      emp: 'synthetic-admin',
      rank: 'CHIEF' as const,
      first_name: 'Synthetic',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    };
    token = await signJwt({ ...claims, role: 'admin' }, h.env.JWT_SIGNING_KEY);
    memberToken = await signJwt({ ...claims, role: 'member' }, h.env.JWT_SIGNING_KEY);
    doGet = vi.fn(() => {
      throw new Error('Read-only results must not hydrate a Durable Object');
    });
    h.env.BID_SESSION = { get: doGet, idFromName: doGet } as never;
    h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at)
      VALUES (101,'synthetic-101','Mutable','Current Name','FF','FF',101,0,1,1);
      INSERT INTO bids (id,bid_session_id,ordinal,member_id,position_id,picked_at,idempotency_key)
      VALUES ('historical-mock-legacy','mock-newer',1,101,'P-ENGINE-1',1,'synthetic-mock-legacy');
    `);
    seedSyntheticOfficialCompletion(h, []);
  });
  afterEach(async () => teardownTestD1(h));

  it('returns only canonical awards with frozen names and A-Day, preserving every database byte', async () => {
    const before = h.sqlite.serialize();
    const response = await request('results');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      session: {
        id: sessionId,
        bidYear: 2027,
        isMock: false,
        currentPhase: 'complete',
        sequence: 12,
      },
      awardSource: 'CANONICAL',
      provenance: {
        valid: true,
        error: null,
        pin: null,
        ruleBookVersion: '2027.1',
        topologyReference: '2027.1',
      },
      awards: [
        {
          memberId: 101,
          name: 'Historical Winner 101',
          positionId: 'P-ENGINE-1',
          positionName: 'Firefighter',
          shift: 'A',
          station: '1',
          unit: 'Engine',
          aDay: 'G1',
          pool: null,
          memberships: [],
        },
        {
          memberId: 202,
          name: 'Historical Winner 202',
          positionId: 'P-RESCUE-1',
          positionName: 'Rescue Firefighter',
          shift: 'B',
          station: '2',
          unit: 'Rescue',
          aDay: 'G2',
          pool: null,
          memberships: [],
        },
      ],
      completion: { verified: true, blockers: [] },
    });
    expect(
      h.sqlite.serialize().length === before.length &&
        h.sqlite.serialize().every((byte, index) => byte === before[index]),
    ).toBe(true);
    expect(doGet).not.toHaveBeenCalled();
  });

  it('returns verified official completion without writes or Durable Object access', async () => {
    const before = h.sqlite.serialize();
    const response = await request('completion');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      ok: true,
      completion: { sessionId, completion: { revision: 12, receiptIntegrity: 'VERIFIED' } },
    });
    expect(
      h.sqlite.serialize().length === before.length &&
        h.sqlite.serialize().every((byte, index) => byte === before[index]),
    ).toBe(true);
    expect(doGet).not.toHaveBeenCalled();
  });

  it.each(['results', 'completion'])(
    'requires an administrator for %s and preserves storage',
    async (endpoint) => {
      const before = h.sqlite.serialize();
      expect((await request(endpoint, sessionId, null)).status).toBe(401);
      expect((await request(endpoint, sessionId, 'invalid')).status).toBe(401);
      expect((await request(endpoint, sessionId, memberToken)).status).toBe(403);
      expect(
        h.sqlite.serialize().length === before.length &&
          h.sqlite.serialize().every((byte, index) => byte === before[index]),
      ).toBe(true);
      expect(doGet).not.toHaveBeenCalled();
    },
  );

  it.each(['results', 'completion'])(
    'returns 404 for missing session %s without hydration',
    async (endpoint) => {
      const before = h.sqlite.serialize();
      const response = await request(endpoint, 'synthetic-missing-session');
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: 'session_not_found' });
      expect(
        h.sqlite.serialize().length === before.length &&
          h.sqlite.serialize().every((byte, index) => byte === before[index]),
      ).toBe(true);
      expect(doGet).not.toHaveBeenCalled();
    },
  );

  it('reports historical Mock canonical data unavailable without merging legacy awards', async () => {
    const before = h.sqlite.serialize();
    const response = await request('results', 'mock-newer');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      session: { id: 'mock-newer', isMock: true, sequence: null },
      awardSource: 'CANONICAL_UNAVAILABLE',
      provenance: { valid: false, error: 'session_policy_snapshot_missing', pin: null },
      awards: [],
      completion: { verified: false, blockers: ['mock_session_not_transitionable'] },
    });
    expect(await (await request('completion', 'mock-newer')).json()).toEqual({
      ok: false,
      error: 'mock_session_not_transitionable',
    });
    expect(
      h.sqlite.serialize().length === before.length &&
        h.sqlite.serialize().every((byte, index) => byte === before[index]),
    ).toBe(true);
    expect(doGet).not.toHaveBeenCalled();
  });

  it('exposes official unresolved-member blockers on both reads without changing canonical awards', async () => {
    h.sqlite
      .prepare(
        "UPDATE canonical_bid_session_state SET current_seq=13,last_command_id='synthetic-unresolved-completion',state_json=json_set(state_json,'$.lastSeq',13,'$.annual.unresolvedMemberIds',json('[101]')) WHERE bid_session_id=?",
      )
      .run(sessionId);
    h.sqlite
      .prepare(
        "INSERT INTO bid_command_receipts (command_id,bid_session_id,command_type,request_sha256,actor_id,expected_seq,result_seq,outcome,result_json,created_at) VALUES ('synthetic-unresolved-completion',?,'live.complete_session',?,99,12,13,'accepted','{}',1)",
      )
      .run(sessionId, 'c'.repeat(64));
    const before = h.sqlite.serialize();
    expect(await (await request('results')).json()).toMatchObject({
      awardSource: 'CANONICAL',
      completion: { verified: false, blockers: ['UNRESOLVED_MEMBERS_BLOCK_TRANSITION'] },
    });
    expect(await (await request('completion')).json()).toEqual({
      ok: false,
      error: 'UNRESOLVED_MEMBERS_BLOCK_TRANSITION',
    });
    expect(
      h.sqlite.serialize().length === before.length &&
        h.sqlite.serialize().every((byte, index) => byte === before[index]),
    ).toBe(true);
    expect(doGet).not.toHaveBeenCalled();
  });
});
