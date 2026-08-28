import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'a'.repeat(64);

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'A',
      last_name: 'B',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

function stubBidSessionNamespace(snapshotFor: Map<string, unknown>): WorkerEnv['BID_SESSION'] {
  const stub = {
    fetch: async (input: Request | string) => {
      const url = typeof input === 'string' ? input : input.url;
      const u = new URL(url);
      if (u.pathname.endsWith('/snapshot')) {
        const id = u.pathname.split('/')[1] ?? 'unknown';
        const snap = snapshotFor.get(id) ?? { currentBidderId: null };
        return new Response(JSON.stringify(snap), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    },
  };
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
    idFromString: () => ({ toString: () => 'id' }) as unknown as DurableObjectId,
    newUniqueId: () => ({ toString: () => 'id' }) as unknown as DurableObjectId,
  } as unknown as WorkerEnv['BID_SESSION'];
}

async function insertV3PolicySnapshot(
  h: TestD1,
  sessionId: string,
  capturedAt: number,
  frozenMembers: ReadonlyArray<{ id: number; seniority: number }>,
) {
  await h.db.run(
    `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
     VALUES (?, '2026.2', '2026.1', 0, ?, ?);`,
    [
      sessionId,
      JSON.stringify({
        v: 3,
        ruleBookVersion: '2026.2',
        ruleBookRevision: 0,
        positionTemplateVersion: '2026.1',
        configurationRevision: 1,
        settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
        capturedAtMs: capturedAt,
        members: frozenMembers.map((member) => ({
          memberId: member.id,
          pool: 'FF',
          rscSeniority: member.seniority,
          rankSeniority: null,
          exclusionReason: null,
          authoritativeAssignmentId: null,
          rank: 'FF',
          isProbationary: false,
          credentialNames: [],
        })),
        ruleBookMaterial: {
          v: 1,
          rules: ['A101', 'A102', 'A103'].map((positionId) => ({
            ruleBookVersion: '2026.2',
            positionId,
            templateVersion: '2026.1',
            requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
            pointsPreferenceJson: '{"max":0,"items":[]}',
            tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
          })),
          positions: ['A101', 'A102', 'A103'].map((id) => ({
            id,
            templateVersion: '2026.1',
            bidParticipation: 'BIDDABLE',
            isExcludedFromCount: false,
            shift: 'A',
            station: '1',
            unit: 'Engine 1',
            rankRequired: 'FF',
            positionName: `${id} unit`,
          })),
        },
      }),
      capturedAt,
    ],
  );
}

async function seedMockSessionWithThreeMembers(h: TestD1, sessionId: string) {
  const now = Date.now();
  const frozenMembers = [
    { id: 201, emp: '201201', sen: 100 },
    { id: 202, emp: '202202', sen: 200 },
    { id: 203, emp: '203203', sen: 300 },
  ];
  for (const m of frozenMembers) {
    await h.db.run(
      'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?);',
      [m.id, m.emp, 'M', String(m.id), 'FF', 'FF', m.sen, now, now],
    );
  }
  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
  );
  for (const p of ['A101', 'A102', 'A103']) {
    await h.db.run(
      "INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name) VALUES (?, '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', ?);",
      [p, `${p} unit`],
    );
  }
  await h.db.run(
    "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.2', 2026, 'draft');",
  );
  for (const p of ['A101', 'A102', 'A103']) {
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.2', ?, '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
      [p],
    );
  }
  await h.db.run(
    `INSERT INTO bid_years
       (year, status, position_template_version, rule_book_version, config_json, configuration_revision)
     VALUES
       (2026, 'configuring', '2026.1', '2026.2',
        '{"v":1,"expectedDurationDays":2,"turnTimerSeconds":180}', 1);`,
  );
  await h.db.run(
    "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, current_bidder_id, is_mock) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1, 201, 1);",
    [sessionId, now],
  );
  await insertV3PolicySnapshot(
    h,
    sessionId,
    now,
    frozenMembers.map((member) => ({ id: member.id, seniority: member.sen })),
  );
  await h.db.run(
    "INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool) VALUES (?, 1, 201, 'FF'), (?, 2, 202, 'FF'), (?, 3, 203, 'FF');",
    [sessionId, sessionId, sessionId],
  );
}

describe('POST /api/admin/rehearsal/:sessionId/auto-bid (Task R5)', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000REH010';

  beforeEach(async () => {
    h = await setupTestD1();
    await seedMockSessionWithThreeMembers(h, sessionId);
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('returns 403 when the session is NOT marked mock', async () => {
    await h.db.run('UPDATE bid_sessions SET is_mock = 0 WHERE id = ?;', [sessionId]);
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ count: 1, strategy: 'first_eligible' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(403);
  });

  it('makes 3 picks with strategy=first_eligible and stops at count_reached', async () => {
    const snapMap = new Map<string, unknown>([[sessionId, { currentBidderId: 201 }]]);
    const env: WorkerEnv = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: stubBidSessionNamespace(snapMap),
    };
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ count: 3, strategy: 'first_eligible' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { picksMade: number; stoppedReason: string };
    expect(body.picksMade).toBe(3);
    expect(['count_reached', 'complete']).toContain(body.stoppedReason);

    const bidsRows = await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [
      sessionId,
    ]);
    expect((bidsRows.results[0] as { n: number }).n).toBe(3);
  });

  it('rejects auto-bid after a canonical command has locked the mock session', async () => {
    await h.db.run(
      `INSERT INTO canonical_bid_session_state
       (bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at)
       VALUES (?, 0, ?, NULL, ?, ?);`,
      [
        sessionId,
        JSON.stringify({
          bidSessionId: sessionId,
          currentPhase: 'paused',
          frozenAt: 1,
          currentBidderId: 201,
          lastSeq: 0,
        }),
        Date.now(),
        Date.now(),
      ],
    );
    const snapMap = new Map<string, unknown>([[sessionId, { currentBidderId: 201 }]]);
    const env: WorkerEnv = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: stubBidSessionNamespace(snapMap),
    };

    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ count: 1, strategy: 'first_eligible' }),
      }),
      env,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'canonical_mutation_requires_command' });
    const bidsRows = await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [
      sessionId,
    ]);
    expect((bidsRows.results[0] as { n: number }).n).toBe(0);
    const sessionRows = await h.db.run(
      'SELECT current_phase, current_bidder_id FROM bid_sessions WHERE id = ?',
      [sessionId],
    );
    expect(sessionRows.results[0]).toMatchObject({
      current_phase: 'position_bid',
      current_bidder_id: 201,
    });
  });

  it('fails closed instead of reusing a stale order that diverges from the frozen pool', async () => {
    const capturedAt = Date.now();
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (204, '204204', 'Stale', 'Order', 'FF', 'FF', 400, 0, ?, ?);",
      [capturedAt, capturedAt],
    );
    await h.db.run(
      "INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool) VALUES (?, 4, 204, 'FF');",
      [sessionId],
    );

    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ count: 1, strategy: 'first_eligible' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'bid_order_not_frozen_policy' });
    expect(
      (await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [sessionId]))
        .results[0],
    ).toMatchObject({ n: 0 });
  });

  it('bootstrap survives a large roster (>100 placeholders worth of rows)', async () => {
    // D1 caps params at ~100 per statement. A real bid has ~226 members ×
    // 4 cols = 904 placeholders, well past the cap; the chunked INSERT must
    // stay green. Add 50 more members on top of the 3 from the seed so
    // we're guaranteed to exceed the 20-row-per-chunk threshold.
    const now = Date.now();
    for (let i = 0; i < 50; i += 1) {
      const id = 300 + i;
      await h.db.run(
        'INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?);',
        [id, String(id), 'M', String(id), 'FF', 'FF', 400 + i, now, now],
      );
    }
    await h.db.run('DELETE FROM bid_session_policy_snapshots WHERE bid_session_id = ?;', [
      sessionId,
    ]);
    await insertV3PolicySnapshot(h, sessionId, now, [
      { id: 201, seniority: 100 },
      { id: 202, seniority: 200 },
      { id: 203, seniority: 300 },
      ...Array.from({ length: 50 }, (_, index) => ({
        id: 300 + index,
        seniority: 400 + index,
      })),
    ]);
    await h.db.run('DELETE FROM bid_order WHERE bid_session_id = ?;', [sessionId]);
    await h.db.run(
      "UPDATE bid_sessions SET current_phase = 'config', current_bidder_id = NULL WHERE id = ?;",
      [sessionId],
    );

    const snapMap = new Map<string, unknown>([[sessionId, { currentBidderId: null }]]);
    const env: WorkerEnv = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: stubBidSessionNamespace(snapMap),
    };
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ count: 1, strategy: 'first_eligible' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bootstrapped?: boolean; stoppedReason: string };
    expect(body.bootstrapped).toBe(true);
    expect(body.stoppedReason).not.toBe('error');

    const orderCount = await h.db.run(
      'SELECT count(*) AS n FROM bid_order WHERE bid_session_id = ?',
      [sessionId],
    );
    // 3 seed members + 50 extras = 53 rows expected.
    expect((orderCount.results[0] as { n: number }).n).toBe(53);
  });

  it('bootstraps bid_order from members + advances to position_bid when session is in config', async () => {
    // Wipe the seed's bid_order rows and rewind the session to config so the
    // auto-bid endpoint has to recompute the queue itself — this is the
    // out-of-the-box mock-session path the chief hit on staging.
    await h.db.run('DELETE FROM bid_order WHERE bid_session_id = ?;', [sessionId]);
    await h.db.run(
      "UPDATE bid_sessions SET current_phase = 'config', current_bidder_id = NULL WHERE id = ?;",
      [sessionId],
    );

    // DO snapshot says no bidder; the bootstrap path must short-circuit the
    // DO read and use the freshly-inserted bid_order rows instead.
    const snapMap = new Map<string, unknown>([[sessionId, { currentBidderId: null }]]);
    const env: WorkerEnv = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: stubBidSessionNamespace(snapMap),
    };
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ count: 3, strategy: 'first_eligible' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      picksMade: number;
      stoppedReason: string;
      bootstrapped?: boolean;
    };
    expect(body.bootstrapped).toBe(true);
    expect(body.picksMade).toBe(3);

    // bid_order was repopulated and the session transitioned out of config.
    const orderCount = await h.db.run(
      'SELECT count(*) AS n FROM bid_order WHERE bid_session_id = ?',
      [sessionId],
    );
    expect((orderCount.results[0] as { n: number }).n).toBe(3);
    const session = await h.db.run('SELECT current_phase FROM bid_sessions WHERE id = ?', [
      sessionId,
    ]);
    expect((session.results[0] as { current_phase: string }).current_phase).not.toBe('config');
  });

  it('passes adminActorId=null (not 0) so bids.admin_actor_id FK is satisfied', async () => {
    // Production D1 enforces foreign_keys = ON. The synthetic "Bid Admin"
    // identity has sub=0 — there's no members row with id=0, so any
    // INSERT INTO bids (admin_actor_id, ...) VALUES (0, ...) blows up with
    // a FOREIGN KEY constraint failure. Verify the handler sends NULL
    // instead by enabling FKs locally before calling auto-bid.
    h.sqlite.pragma('foreign_keys = ON');

    const snapMap = new Map<string, unknown>([[sessionId, { currentBidderId: 201 }]]);
    const env: WorkerEnv = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: stubBidSessionNamespace(snapMap),
    };
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ count: 2, strategy: 'first_eligible' }),
      }),
      env,
    );
    // Should not 500 — the FK column accepts NULL for the admin actor.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { picksMade: number; stoppedReason: string };
    expect(body.picksMade).toBe(2);

    const bidsRows = await h.db.run('SELECT admin_actor_id FROM bids WHERE bid_session_id = ?', [
      sessionId,
    ]);
    for (const row of bidsRows.results) {
      // Either NULL or a real member id — never 0.
      expect((row as { admin_actor_id: number | null }).admin_actor_id).not.toBe(0);
    }
  });

  it('returns 400 on invalid body (count<=0 or unknown strategy)', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ count: 0, strategy: 'first_eligible' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });
});
