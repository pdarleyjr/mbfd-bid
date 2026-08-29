import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'd'.repeat(64);

async function freshAdmin(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'B',
      last_name: 'A',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

describe('POST /api/admin/bid-session/:id/force-pick', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000SESS10';
  beforeEach(async () => {
    h = await setupTestD1();
    const capturedAt = Date.now();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
      [sessionId, Date.now()],
    );
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (42, '12345', 'Force', 'Test', 'FF', 'FF', 200, 0, ?, ?);",
      [Date.now(), Date.now()],
    );
    await h.db.run(
      "INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool) VALUES (?, 1, 42, 'FF');",
      [sessionId],
    );
    await h.db.run(
      "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
    );
    await h.db.run(
      "INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name) VALUES ('A205', '2026.1', 'A', '2', 'Combat', 'Rescue', 'FF', 'Rescue Firefighter');",
    );
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.1', 2026, 'active');",
    );
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.1', 'A205', '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
    );
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
        (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
       VALUES (?, '2026.1', '2026.1', 0, ?, ?);`,
      [
        sessionId,
        JSON.stringify({
          v: 3,
          ruleBookVersion: '2026.1',
          ruleBookRevision: 0,
          positionTemplateVersion: '2026.1',
          configurationRevision: 0,
          settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
          capturedAtMs: capturedAt,
          members: [
            {
              memberId: 42,
              pool: 'FF',
              rscSeniority: 200,
              rankSeniority: null,
              exclusionReason: null,
              authoritativeAssignmentId: null,
              rank: 'FF',
              isProbationary: false,
              credentialNames: [],
            },
          ],
          ruleBookMaterial: {
            v: 1,
            rules: [
              {
                ruleBookVersion: '2026.1',
                positionId: 'A205',
                templateVersion: '2026.1',
                requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
                pointsPreferenceJson: '{"max":0,"items":[]}',
                tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
              },
            ],
            positions: [
              {
                id: 'A205',
                templateVersion: '2026.1',
                bidParticipation: 'BIDDABLE',
                isExcludedFromCount: false,
                shift: 'A',
                station: '2',
                unit: 'Rescue',
                rankRequired: 'FF',
                positionName: 'Rescue Firefighter',
              },
            ],
          },
        }),
        capturedAt,
      ],
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('records a bid with forced=true and no invented actor when the admin is not a member', async () => {
    h.sqlite.pragma('foreign_keys = ON');
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'force.cert_mandate',
          reason: 'Minimum Paramedic staffing on A-shift Rescue.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { bid_id: string; forced: true };
    expect(body.forced).toBe(true);

    const rows = await h.db.run(
      'SELECT forced, admin_actor_id, reason, position_id FROM bids WHERE id = ?',
      [body.bid_id],
    );
    const r = rows.results[0] as
      | { forced: number; admin_actor_id: number | null; reason: string; position_id: string }
      | undefined;
    expect(r?.forced).toBe(1);
    expect(r?.admin_actor_id).toBeNull();
    expect(r?.position_id).toBe('A205');
  });

  it('writes forced_pick audit entry', async () => {
    await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'force.reverse_seniority',
          reason: 'Last qualified bidder.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const audit = await h.db.run(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'forced_pick' AND bid_session_id = ?",
      [sessionId],
    );
    expect(audit.results[0]?.n).toBe(1);
  });

  it('does not let an unstarted live session bypass the normal start gate', async () => {
    await h.db.run("UPDATE bid_sessions SET current_phase = 'config' WHERE id = ?", [sessionId]);

    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'force.cert_mandate',
          reason: 'A config-phase session cannot receive a real award.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'bid_session_not_active', current_phase: 'config' });
    expect(
      (await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [sessionId]))
        .results,
    ).toEqual([{ n: 0 }]);
    expect(
      (
        await h.db.run(
          "SELECT count(*) AS n FROM audit_log WHERE action = 'forced_pick' AND bid_session_id = ?",
          [sessionId],
        )
      ).results,
    ).toEqual([{ n: 0 }]);
  });

  it('rejects a canonical session before creating a legacy bid or audit row', async () => {
    await h.db.run('UPDATE bid_sessions SET is_mock = 1 WHERE id = ?', [sessionId]);
    await h.db.run(
      `INSERT INTO canonical_bid_session_state (
        bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
      ) VALUES (?, 1, ?, 'freeze-command', ?, ?)`,
      [sessionId, JSON.stringify({ bidSessionId: sessionId, lastSeq: 1 }), Date.now(), Date.now()],
    );

    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'force.cert_mandate',
          reason: 'Canonical authority blocks this legacy path.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'canonical_mutation_requires_command' });
    expect(
      (await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [sessionId]))
        .results,
    ).toEqual([{ n: 0 }]);
    expect(
      (
        await h.db.run(
          "SELECT count(*) AS n FROM audit_log WHERE bid_session_id = ? AND action = 'forced_pick'",
          [sessionId],
        )
      ).results,
    ).toEqual([{ n: 0 }]);
  });

  it('rejects skip.unreachable as a force-pick reason_code (400 invalid_reason_for_action)', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'skip.unreachable',
          reason: 'wrong category code',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });

  it('returns the same bid_id on idempotent retry (same Idempotency-Key header)', async () => {
    const key = 'idem-test-1';
    const make = async () =>
      app.fetch(
        new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await freshAdmin()}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body: JSON.stringify({
            member_id: 42,
            position_id: 'A205',
            reason_code: 'force.cert_mandate',
            reason: 'idempotent retry',
          }),
        }),
        { ...h.env, JWT_SIGNING_KEY: KEY },
      );
    const r1 = (await (await make()).json()) as { bid_id: string };
    const r2 = (await (await make()).json()) as { bid_id: string };
    expect(r1.bid_id).toBe(r2.bid_id);
  });

  it('rechecks idempotency after acquiring the durable normal-mutation permit', async () => {
    const key = 'idem-race-after-lease-1';
    let injected = false;
    const bidId = '01HZZ0000000000000RACEREPLAY';
    const bidSessionNamespace: WorkerEnv['BID_SESSION'] = {
      idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
      get: () =>
        ({
          fetch: async (input: Request | string) => {
            const url = typeof input === 'string' ? input : input.url;
            const pathname = new URL(url).pathname;
            if (pathname === '/admin/normal-mutation-lease/acquire') {
              // The first pre-lease idempotency read has already observed no
              // row. This models another serialized writer committing before
              // this request receives its own permit.
              if (!injected) {
                injected = true;
                await h.db.run(
                  `INSERT INTO bids
                    (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced,
                     idempotency_key, portal_sync_status, portal_sync_attempts)
                   VALUES (?, ?, 1, 42, 'A205', ?, 1, ?, 'pending', 0);`,
                  [bidId, sessionId, Date.now(), key],
                );
              }
              return new Response(
                JSON.stringify({ ok: true, lease_id: 'force-pick-race-test-lease' }),
                { status: 200 },
              );
            }
            if (pathname === '/admin/normal-mutation-lease/release') {
              return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }
            return new Response('not found', { status: 404 });
          },
        }) as unknown as DurableObjectStub,
    } as unknown as WorkerEnv['BID_SESSION'];

    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'force.cert_mandate',
          reason: 'Recheck idempotency after the normal mutation permit is held.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY, BID_SESSION: bidSessionNamespace },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bid_id: bidId,
      forced: true,
      idempotent_replay: true,
    });
    expect(
      (await h.db.run('SELECT count(*) AS n FROM bids WHERE idempotency_key = ?', [key])).results,
    ).toEqual([{ n: 1 }]);
  });

  it('returns 400 when reason text < 4 chars', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'force.cert_mandate',
          reason: 'a',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });
});
