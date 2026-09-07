import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'k'.repeat(64);
const SESSION_ID = '01HZZ0000000000000ADAYFROZEN';
const CAPTURED_AT = 1_784_070_000_000;

type DurableCall = { path: string; body: unknown };

function stubBidSessionNamespace(calls: DurableCall[]): WorkerEnv['BID_SESSION'] {
  const stub = {
    fetch: async (input: Request | string, init?: RequestInit) => {
      calls.push({
        path: typeof input === 'string' ? new URL(input).pathname : new URL(input.url).pathname,
        body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      });
      return new Response(
        JSON.stringify({
          kind: 'accepted',
          pick: {
            memberId: 7,
            shift: 'A',
            aDay: 'G1',
            pickedAtMs: CAPTURED_AT + 1,
            forced: true,
            adminActorId: 0,
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    },
  };
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
    idFromString: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
    newUniqueId: () => ({ toString: () => 'stub-do-id' }) as DurableObjectId,
  } as unknown as WorkerEnv['BID_SESSION'];
}

async function freshAdmin(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'synthetic-admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Synthetic',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

function frozenV3Snapshot() {
  return {
    v: 3,
    ruleBookVersion: 'synthetic-2026.2',
    ruleBookRevision: 7,
    positionTemplateVersion: 'synthetic-template',
    configurationRevision: 4,
    settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
    capturedAtMs: CAPTURED_AT,
    members: [
      {
        memberId: 7,
        pool: 'FF',
        rscSeniority: 4,
        rankSeniority: 5,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'FF',
        isProbationary: false,
        credentialNames: ['Synthetic credential'],
      },
    ],
    ruleBookMaterial: {
      v: 1,
      rules: [
        {
          ruleBookVersion: 'synthetic-2026.2',
          positionId: 'A101',
          templateVersion: 'synthetic-template',
          requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
          pointsPreferenceJson: '{"max":0,"items":[]}',
          tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
        },
      ],
      positions: [
        {
          id: 'A101',
          templateVersion: 'synthetic-template',
          bidParticipation: 'BIDDABLE',
          isExcludedFromCount: false,
          shift: 'A',
          station: '1',
          unit: 'Synthetic Unit',
          rankRequired: 'FF',
          positionName: 'Synthetic Firefighter',
        },
      ],
    },
  };
}

async function seedSession(h: TestD1): Promise<void> {
  await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'configuring');");
  await h.db.run(
    `INSERT INTO members
       (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, rank_seniority, is_probationary, created_at, updated_at)
     VALUES (7, 'mutable-member', 'Mutable', 'Roster', 'CHIEF', 'OFC', 99, 99, 1, ?, ?);`,
    [CAPTURED_AT, CAPTURED_AT],
  );
  await h.db.run(
    `INSERT INTO rule_books (version, effective_year, status, revision)
     VALUES ('synthetic-2026.2', 2026, 'active', 7);`,
  );
  await h.db.run(
    `INSERT INTO bid_sessions
       (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock)
     VALUES (?, 2026, ?, 'a_day_bid', 180, 2, 0, 1);`,
    [SESSION_ID, CAPTURED_AT],
  );
}

async function seedV3Snapshot(h: TestD1): Promise<void> {
  const snapshot = frozenV3Snapshot();
  await h.db.run(
    `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [
      SESSION_ID,
      snapshot.ruleBookVersion,
      snapshot.positionTemplateVersion,
      snapshot.ruleBookRevision,
      JSON.stringify(snapshot),
      CAPTURED_AT,
    ],
  );
}

async function seedLegacyV2Snapshot(h: TestD1): Promise<void> {
  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('synthetic-template', 2026);",
  );
  await h.db.run(
    `INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
     VALUES ('A101', 'synthetic-template', 'A', '1', 'Synthetic', 'Unit', 'FF', 'Synthetic FF');`,
  );
  await h.db.run(
    `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
     VALUES
       ('synthetic-2026.2', 'A101', 'synthetic-template',
        '{"rank":["FF"],"credentials":[],"custom":[]}',
        '{"max":0,"items":[]}',
        '["points","rsc_seniority","rank_seniority"]');`,
  );
  const snapshot = {
    v: 2,
    ruleBookVersion: 'synthetic-2026.2',
    ruleBookRevision: 7,
    positionTemplateVersion: 'synthetic-template',
    configurationRevision: 4,
    settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
    capturedAtMs: CAPTURED_AT,
    members: [
      {
        memberId: 7,
        pool: 'FF',
        rscSeniority: 4,
        rankSeniority: 5,
        exclusionReason: null,
        authoritativeAssignmentId: null,
      },
    ],
  };
  await h.db.run(
    `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [
      SESSION_ID,
      snapshot.ruleBookVersion,
      snapshot.positionTemplateVersion,
      snapshot.ruleBookRevision,
      JSON.stringify(snapshot),
      CAPTURED_AT,
    ],
  );
}

async function request(): Promise<Request> {
  return new Request(`http://x/api/admin/bid-session/${SESSION_ID}/force-a-day`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await freshAdmin()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      member_id: 7,
      a_day: 'G1',
      reason: 'Synthetic forced A-Day snapshot test.',
    }),
  });
}

describe('POST /api/admin/bid-session/:id/force-a-day frozen V3 member material', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('forwards rank and seniority only from the immutable V3 session snapshot', async () => {
    await seedSession(h);
    await seedV3Snapshot(h);
    const calls: DurableCall[] = [];

    const res = await app.fetch(await request(), {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: stubBidSessionNamespace(calls),
    });

    expect(res.status).toBe(200);
    expect(calls).toEqual([
      {
        path: '/submit-a-day-pick',
        body: expect.objectContaining({
          senderMemberId: 7,
          aDay: 'G1',
          forced: true,
          members: [
            {
              employeeId: '7',
              memberId: 7,
              firstName: '',
              lastName: '',
              rank: 'FF',
              rscSeniority: 4,
              rankSeniority: 5,
              isProbationary: false,
              credentials: [{ name: 'Synthetic credential' }],
              serviceCredits: [],
            },
          ],
        }),
      },
    ]);
  });

  it('fails closed before contacting the DO when a V3 immutable snapshot is absent', async () => {
    await seedSession(h);
    const calls: DurableCall[] = [];

    const res = await app.fetch(await request(), {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: stubBidSessionNamespace(calls),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'session_policy_snapshot_material_missing',
    });
    expect(calls).toEqual([]);
    expect(
      (
        await h.db.run('SELECT count(*) AS n FROM a_day_picks WHERE bid_session_id = ?', [
          SESSION_ID,
        ])
      ).results,
    ).toEqual([{ n: 0 }]);
    expect(
      (
        await h.db.run(
          "SELECT count(*) AS n FROM audit_log WHERE bid_session_id = ? AND action = 'forced_a_day_pick'",
          [SESSION_ID],
        )
      ).results,
    ).toEqual([{ n: 0 }]);
  });

  it('fails closed for a legacy V2 snapshot that lacks immutable A-Day member material', async () => {
    await seedSession(h);
    await seedLegacyV2Snapshot(h);
    const calls: DurableCall[] = [];

    const res = await app.fetch(await request(), {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      BID_SESSION: stubBidSessionNamespace(calls),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'session_policy_snapshot_material_missing',
    });
    expect(calls).toEqual([]);
  });
});
