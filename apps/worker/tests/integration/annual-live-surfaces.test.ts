import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'u'.repeat(64);
const SESSION = '01HZZ000000000ANNUALLIVE1';
const MOCK_SESSION = '01HZZ000000000ANNUALMOCK1';
const actions = [
  'record_selection',
  'amend_selection',
  'skip_defer',
  'mark_unreachable',
  'force',
  'resolve_tie',
  'alter_order',
  'pause_resume',
  'approve_transition',
  'approve_final_results',
  'publish',
];
const dispositions = ['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'];

async function token(role: 'admin' | 'member', memberId: number): Promise<string> {
  return signJwt(
    {
      sub: memberId,
      emp: `annual-${memberId}`,
      role,
      rank: role === 'admin' ? 'CHIEF' : 'FF',
      first_name: 'Annual',
      last_name: role === 'admin' ? 'Operator' : 'Viewer',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

describe('annual live operator and presentation surfaces', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    const policy = {
      v: 1,
      policyRevision: 'annual-live-1',
      stages: [
        {
          id: 'ff',
          label: 'ABC Firefighter',
          order: 0,
          memberIds: [1, 2],
          opportunityPositionIds: ['A101'],
          kind: 'FIREFIGHTER',
        },
      ],
      dispositions: dispositions.map((disposition) => ({
        disposition,
        advances: true,
        returns: false,
        returnStageId: null,
        retainsLaterSelectionRights: false,
        terminal: false,
        requiresReason: true,
        requiresEvidence: disposition === 'UNREACHABLE',
        contactPolicyReference: 'contact-1',
      })),
      actionPermissions: actions.map((action) => ({ action, actorMemberIds: [99] })),
      specialtyCatalogReference: 'specialty-1',
      aDayPolicyReference: 'aday-1',
      transitionPolicyReference: 'transition-1',
      publicationPolicyReference: 'publication-1',
      annualOperations: {
        v: 1,
        stageOrder: ['ff'],
        requiredTopologyPositionIds: ['A101'],
        specialties: [
          {
            id: 'marine',
            label: 'Marine',
            mode: 'INTERRUPTING',
            opportunityPositionIds: ['A101'],
            requiredCredentialNames: ['Marine'],
            requiredSpecialtyCodes: ['MARINE'],
            points: [{ credentialName: 'Marine', value: 5 }],
            tieBreakChain: ['POINTS', 'RSC_SENIORITY'],
          },
        ],
        contact: {
          minimumAttempts: 2,
          timingMode: 'OPERATOR_DISCRETION',
          durationSeconds: null,
          evidenceRequired: true,
        },
        aDay: {
          combatGroups: ['G1', 'G2', 'G3', 'G4'],
          min: 1,
          max: 2,
          captainDcMax: 1,
          specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
        },
      },
    };
    const snapshot = {
      v: 3,
      ruleBookVersion: '2027.1',
      ruleBookRevision: 1,
      positionTemplateVersion: '2027.1',
      configurationRevision: 1,
      settings: {
        v: 3,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2027-01-15',
        livePolicy: policy,
      },
      credentialEvaluationOn: '2027-01-15',
      capturedAtMs: 1,
      members: [
        {
          memberId: 1,
          pool: 'FF',
          rscSeniority: 2,
          rankSeniority: 2,
          exclusionReason: null,
          authoritativeAssignmentId: null,
          rank: 'FF',
          isProbationary: false,
          credentialNames: ['Marine'],
          specialtyQualifications: [
            {
              specialtyCode: 'MARINE',
              status: 'active',
              effectiveOn: '2020-01-01',
              expiresOn: null,
            },
          ],
        },
        {
          memberId: 2,
          pool: 'FF',
          rscSeniority: 1,
          rankSeniority: 1,
          exclusionReason: null,
          authoritativeAssignmentId: null,
          rank: 'FF',
          isProbationary: false,
          credentialNames: ['Marine'],
          specialtyQualifications: [
            {
              specialtyCode: 'MARINE',
              status: 'active',
              effectiveOn: '2020-01-01',
              expiresOn: null,
            },
          ],
        },
      ],
      operatorIdentityProjection: [
        { memberId: 1, employeeId: '1', firstName: 'First', lastName: 'Bidder', rank: 'FF' },
        { memberId: 2, employeeId: '2', firstName: 'Higher', lastName: 'Candidate', rank: 'FF' },
      ],
      ruleBookMaterial: {
        v: 1,
        rules: [
          {
            ruleBookVersion: '2027.1',
            positionId: 'A101',
            templateVersion: '2027.1',
            requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
            pointsPreferenceJson: '{"max":0,"items":[]}',
            tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
          },
        ],
        positions: [
          {
            id: 'A101',
            templateVersion: '2027.1',
            bidParticipation: 'BIDDABLE',
            isExcludedFromCount: false,
            shift: 'A',
            station: '1',
            unit: 'Engine 1',
            rankRequired: 'FF',
            positionName: 'Firefighter',
          },
        ],
      },
    };
    const held = {
      currentBidderId: 1,
      currentStageId: 'ff',
      currentPhase: 'position_bid',
      fills: {},
      bidOrder: [
        { ordinal: 1, memberId: 1, pool: 'FF', stageId: 'ff' },
        { ordinal: 2, memberId: 2, pool: 'FF', stageId: 'ff' },
      ],
      queueCursor: 0,
      specialty: {
        specialtyId: 'marine',
        positionId: 'A101',
        suspendedBidderId: 1,
        candidateMemberIds: [2],
        candidateCursor: 0,
      },
    };
    const canonical = {
      bidSessionId: SESSION,
      currentPhase: 'position_bid',
      currentBidderId: 2,
      turnStartedAtMs: 1,
      turnTimerSeconds: 180,
      lastSeq: 8,
      fills: { A101: { memberId: 2, ordinal: 2, bidId: 'b2' } },
      bidOrder: held.bidOrder,
      queueCursor: 1,
      frozenAt: null,
      aDay: null,
      annual: {
        preferenceSheets: [],
        contactAttempts: [{ memberId: 2, method: 'PHONE', actorMemberId: 99, atMs: 10 }],
        unresolvedMemberIds: [],
        returnedAtCurrentSequence: [],
        returningMemberId: null,
        checkpoint: null,
        completion: null,
      },
      live: {
        currentStageId: 'ff',
        completedStageIds: [],
        pausedPhase: null,
        lastSelectionBidId: 'b2',
        dispositions: [],
        specialty: held.specialty,
        presentation: { mode: 'HOLD', heldAtSeq: 7, heldProjection: held },
      },
    };
    await h.db.run(
      "INSERT INTO bid_years (year,status) VALUES (2027,'live'); INSERT INTO position_templates (version,effective_year) VALUES ('2027.1',2027); INSERT INTO rule_books (version,effective_year,status,revision) VALUES ('2027.1',2027,'active',1); INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at) VALUES (1,'1','First','Bidder','FF','FF',2,0,1,1),(2,'2','Higher','Candidate','FF','FF',1,0,1,1);",
    );
    await h.db.run(
      "INSERT INTO bid_sessions (id,bid_year,started_at,current_phase,current_bidder_id,turn_timer_seconds,expected_duration_days,day_count,is_mock) VALUES (?,2027,1,'position_bid',2,180,2,0,0)",
      [SESSION],
    );
    await h.db.run(
      "INSERT INTO bid_session_policy_snapshots (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at) VALUES (?,'2027.1','2027.1',1,?,1)",
      [SESSION, JSON.stringify(snapshot)],
    );
    await h.db.run(
      "INSERT INTO canonical_bid_session_state (bid_session_id,current_seq,state_json,last_command_id,created_at,updated_at) VALUES (?,8,?,'c8',1,1)",
      [SESSION, JSON.stringify(canonical)],
    );
  });
  afterEach(async () => teardownTestD1(h));

  it('returns frozen higher-priority candidate facts and contact history only to Admin', async () => {
    const response = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${SESSION}/specialty-live`, {
        headers: { Authorization: `Bearer ${await token('admin', 99)}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sequence: 8,
      active: {
        original_bidder: { member_id: 1, policy_rank: 2 },
        candidates: [
          {
            member_id: 2,
            points: 5,
            policy_rank: 1,
            status: 'CURRENT',
            contact_history: [{ method: 'PHONE' }],
          },
        ],
        suspended_turn: true,
        resume: { member_id: 1, queue_cursor: 1 },
      },
    });
  });

  it('serves canonical specialty state for an isolated mock rehearsal', async () => {
    await h.db.run(
      "INSERT INTO bid_sessions (id,bid_year,started_at,current_phase,current_bidder_id,turn_timer_seconds,expected_duration_days,day_count,is_mock) VALUES (?,2027,2,'position_bid',2,180,2,0,1)",
      [MOCK_SESSION],
    );
    await h.db.run(
      'INSERT INTO bid_session_policy_snapshots (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at) SELECT ?,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at FROM bid_session_policy_snapshots WHERE bid_session_id=?',
      [MOCK_SESSION, SESSION],
    );
    await h.db.run(
      "INSERT INTO canonical_bid_session_state (bid_session_id,current_seq,state_json,last_command_id,created_at,updated_at) SELECT ?,current_seq,json_set(state_json, '$.bidSessionId', ?),last_command_id,created_at,updated_at FROM canonical_bid_session_state WHERE bid_session_id=?",
      [MOCK_SESSION, MOCK_SESSION, SESSION],
    );
    const response = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${MOCK_SESSION}/specialty-live`, {
        headers: { Authorization: `Bearer ${await token('admin', 99)}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      bid_session_id: MOCK_SESSION,
      sequence: 8,
      active: { suspended_turn: true },
    });
  });

  it('holds a member-safe projection while canonical execution continues', async () => {
    const response = await app.fetch(
      new Request(`http://x/api/presentation?bidSessionId=${SESSION}`, {
        headers: { Authorization: `Bearer ${await token('member', 1)}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      mode: 'HOLD',
      held_at_sequence: 7,
      current_bidder: { member_id: 1, name: 'First Bidder' },
      progress: { filled: 0, total: 1 },
      specialty: { status: 'PRIORITY REVIEW IN PROGRESS' },
    });
    expect(JSON.stringify(body)).not.toContain('credential');
    expect(JSON.stringify(body)).not.toContain('contact_history');
  });

  it('starts the first specialty command from initialized DO state before a canonical row exists', async () => {
    const firstCommandSession = '01HZZ000000000ANNUALLIVE2';
    const stateRow = await h.db.run(
      'SELECT state_json FROM canonical_bid_session_state WHERE bid_session_id=?',
      [SESSION],
    );
    const state = JSON.parse(String(stateRow.results[0]?.state_json)) as Record<string, unknown>;
    state.bidSessionId = firstCommandSession;
    state.currentBidderId = 1;
    state.queueCursor = 0;
    state.fills = {};
    state.live = {
      ...((state.live as Record<string, unknown> | undefined) ?? {}),
      specialty: null,
      lastSelectionBidId: null,
    };
    const snapshotRow = await h.db.run(
      'SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id=?',
      [SESSION],
    );
    await h.db.run(
      "INSERT INTO bid_sessions (id,bid_year,started_at,current_phase,current_bidder_id,turn_timer_seconds,expected_duration_days,day_count,is_mock) VALUES (?,2027,1,'position_bid',1,180,2,0,0)",
      [firstCommandSession],
    );
    await h.db.run(
      "INSERT INTO bid_session_policy_snapshots (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at) VALUES (?,'2027.1','2027.1',1,?,1)",
      [firstCommandSession, snapshotRow.results[0]?.snapshot_json],
    );
    let dispatched: Record<string, unknown> | null = null;
    const stub = {
      fetch: async (input: Request | string, init?: RequestInit) => {
        const pathname = new URL(typeof input === 'string' ? input : input.url).pathname;
        if (pathname === '/admin/state/live')
          return new Response(JSON.stringify(state), { status: 200 });
        if (pathname === '/admin/commands/live') {
          dispatched = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(JSON.stringify({ kind: 'accepted', seq: 9 }), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      },
    };
    h.env.BID_SESSION = {
      idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
      get: () => stub as unknown as DurableObjectStub,
    } as unknown as WorkerEnv['BID_SESSION'];

    const response = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${firstCommandSession}/commands/live`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await token('admin', 99)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          v: 1,
          type: 'live.start_specialty_adjudication',
          commandId: '00000000-0000-4000-8000-000000000099',
          expectedSeq: 8,
          reason: 'Start the frozen Marine priority sequence.',
          evidenceReference: null,
          specialtyId: 'marine',
          positionId: 'A101',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(response.status).toBe(200);
    expect(dispatched).toMatchObject({
      type: 'live.start_specialty_adjudication',
      candidateMemberIds: [2],
    });
  });

  it('rejects a member JWT before any real canonical mutation is dispatched', async () => {
    const response = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${SESSION}/commands/live`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await token('member', 1)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          v: 1,
          type: 'live.record_selection',
          commandId: '00000000-0000-4000-8000-000000000001',
          expectedSeq: 8,
          reason: 'Member must not mutate real Bid.',
          evidenceReference: null,
          memberId: 1,
          positionId: 'A101',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(response.status).toBe(403);
  });
});
