import { createHash } from 'node:crypto';

import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  type LiveBidCommand,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitLiveBidCommand } from '../../src/commands/canonical-command-service.js';
import { getDb } from '../../src/db/index.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { app } from '../../src/index.js';
import { bidDefinitionContextHash } from '../../src/lib/bid-definition-context.js';
import type { PinnedBidSessionPolicySnapshot } from '../../src/lib/bid-definition-pin.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import {
  evaluateRuleBookCoverage,
  loadBidEvaluationEvidence,
  loadBidSessionPolicySnapshot,
  prepareCapturedBidEvaluation,
} from '../../src/lib/bid-policy.js';
import { signJwt } from '../../src/lib/jwt.js';
import {
  type PersonnelLifecycleProjectionEvent,
  derivePersonnelMemberAsOf,
} from '../../src/lib/personnel-lifecycle.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const SESSION = 'synthetic-command-integrity-session';
const SEAT = 'synthetic-command-integrity-seat';
const PRIOR_SEAT = 'synthetic-prior-seat';
const MEMBER = 10001;
const SECOND = 10002;
const ORIGIN = 'synthetic-protected-seat';
const NOW = Date.parse('2027-01-01T10:00:00.000Z');
const KEY = 'b8619c19-0b60-4dcc-aa6b-eec70a733e65';
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
// Synthetic, schema-valid execution inputs only. The real store seals the
// definition; manually inserting a valid snapshot here does not publish a Bid
// or establish that this private draft is authorized to start Live execution.
function syntheticPolicy(ordinary = false) {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-command-integrity-policy',
    stages: [
      {
        id: 'synthetic-ff',
        label: 'Synthetic firefighter stage',
        order: 0,
        memberIds: [MEMBER, SECOND],
        opportunityPositionIds: [SEAT, PRIOR_SEAT],
        kind: 'FIREFIGHTER',
      },
    ],
    dispositions: BidDispositionSchema.options.map((disposition) => ({
      disposition,
      advances: true,
      returns: false,
      returnStageId: null,
      retainsLaterSelectionRights: false,
      terminal: false,
      requiresReason: true,
      requiresEvidence: false,
      contactPolicyReference: null,
    })),
    actionPermissions: LiveBidActionSchema.options.map((action) => ({
      action,
      actorMemberIds: [MEMBER],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
    annualOperations: {
      v: 1,
      stageOrder: ['synthetic-ff'],
      requiredTopologyPositionIds: [SEAT, PRIOR_SEAT],
      specialties: [
        {
          id: 'synthetic-specialty',
          label: 'Synthetic specialty',
          mode: 'INTERRUPTING',
          opportunityPositionIds: [SEAT],
          requiredCredentialNames: [],
          requiredSpecialtyCodes: [],
          points: [],
          tieBreakChain: ['RSC_SENIORITY'],
        },
      ],
      assignmentTerms: ordinary
        ? []
        : [
            {
              id: 'synthetic-protected-term',
              positionIds: [ORIGIN],
              requiredServiceMonths: 36,
              reopenAfterConsecutiveCycles: 3,
              closedForThisBid: false,
              sourceRef: 'synthetic:term-policy',
            },
          ],
      contact: { minimumAttempts: 1, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 0,
        max: 2,
        captainDcMax: 1,
        specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
        execution: {
          timing: 'SIMULTANEOUS',
          officersPerGroup: null,
          sourceRef: 'synthetic:aday-command-policy',
          constraints: [
            {
              id: 'synthetic-member-limit',
              label: 'Synthetic member limit',
              sourceRef: 'synthetic:member-limit',
              maximum: 10,
              positionIds: [],
              memberIds: [MEMBER, SECOND],
              ranks: [],
              shifts: ['A'],
            },
          ],
        },
      },
    },
  });
}

describe('canonical voluntary term departure and transition', () => {
  const commandType = 'live.record_selection' as const;
  let h: TestD1;
  let snapshot: PinnedBidSessionPolicySnapshot;
  let policy: FrozenLiveBidPolicy;
  let state: BidSessionState;
  let nextId: number;
  let prepareAgain: (
    mode: 'mock' | 'live' | 'participant_preview',
  ) => ReturnType<typeof prepareCapturedBidEvaluation>;

  beforeEach(async ({ task }) => {
    const ordinary = task.name.includes('ordinary preexisting canonical');
    const missingTermEvidence = task.name.includes('missing tenure facts');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    nextId = 0;
    const settings = {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      personnelEvaluationOn: '2027-01-01',
      livePolicy: syntheticPolicy(ordinary),
    };
    h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
        VALUES (10001,'synthetic-command-editor','Synthetic','Editor','FF','FF',1,1,1),(10002,'synthetic-second','Synthetic','Second','FF','FF',2,1,1);
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic topology');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',4,'Synthetic rules');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision)
        VALUES (2027,'configuring','2027.1','2027.1',3);
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('${SEAT}','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic firefighter');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','${SEAT}','2027.1','{"rank":["FF"],"credentials":[],"custom":["non_probationary"]}',
          '{"max":0,"items":[]}','["rsc_seniority"]');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('${PRIOR_SEAT}','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic prior seat');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','${PRIOR_SEAT}','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}',
          '{"max":0,"items":[]}','["rsc_seniority"]');
    `);
    h.sqlite
      .prepare('UPDATE bid_years SET config_json=? WHERE year=2027')
      .run(JSON.stringify(settings));
    h.sqlite.exec(`UPDATE members SET employment_status='active',employment_status_effective_on='2026-01-01';
      INSERT INTO staffing_positions (id,stable_slot_key,division,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at) VALUES
      ('source-staffing','SOURCE/TERM','Days','D','Training','Training','Instructor','FF','2026-01-01','approved',1,1),
      ('target-staffing','TARGET/ONE','Combat','A','7','Engine','Firefighter','FF','2026-01-01','approved',1,1),
      ('second-staffing','TARGET/TWO','Combat','A','7','Engine','Firefighter','FF','2026-01-01','approved',1,1);
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name) VALUES ('${ORIGIN}','2027.1','D','Training','Days','Training','FF','Instructor');
      INSERT INTO rule_book_position_participation (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at) VALUES ('2027.1','${ORIGIN}','2027.1','ADMIN_ASSIGNED_NON_BIDDABLE','synthetic:term-policy',1);
      INSERT INTO position_staffing_bindings (template_version,position_id,staffing_position_id,review_status,authoritative_source_ref,created_at) VALUES
      ('2027.1','${ORIGIN}','source-staffing','approved','synthetic:source-binding',1),
      ('2027.1','${SEAT}','target-staffing','approved','synthetic:target-binding',1),
      ('2027.1','${PRIOR_SEAT}','second-staffing','approved','synthetic:second-binding',1);
      INSERT INTO member_assignments (id,member_id,staffing_position_id,origin_type,origin_ref,status,effective_from,effective_to,created_at,updated_at) SELECT 'source-assignment',10001,'source-staffing','ADMIN_TRANSFER','synthetic:source-assignment','active','2026-01-01',NULL,1,1 WHERE ${ordinary ? 0 : 1};
      INSERT INTO staffing_tenure_evidence (id,staffing_position_id,revision,effective_on,status,member_id,protected_from,protected_through,source_ref,actor_subject,reason,idempotency_key,request_json,created_at,term_member_id,accumulated_service_months,consecutive_bid_cycles) SELECT 'source-term-evidence','source-staffing',1,'2026-01-01','PROTECTED',10001,'2026-01-01','2028-12-31','synthetic:term-record','10001','Synthetic prior service facts','synthetic-term-key','{}',1,10001,36,2 WHERE ${ordinary || missingTermEvidence ? 0 : 1};
      `);
    if (task.name.includes('finite term source')) {
      h.sqlite
        .prepare(
          "UPDATE member_assignments SET effective_to='2027-01-15' WHERE id='source-assignment'",
        )
        .run();
    }
    const captured = await captureBidDefinitionSource(h.env.DB, 2027);
    if (!captured.ok) throw new Error(JSON.stringify(captured));
    const saved = await saveBidDefinition(h.env.DB, {
      year: 2027,
      key: 'synthetic-command-adoption',
      actorSubject: 'synthetic-command-editor',
      actorId: MEMBER,
      expected: { kind: 'legacy', sourceToken: captured.sourceToken },
      reason: 'Synthetic command integrity fixture',
      intent: { operation: 'save', content: captured.content },
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const version = await loadBidDefinitionVersion(
      h.env.DB,
      2027,
      String(saved.response.versionId),
    );
    if (!version.ok) throw new Error(JSON.stringify(version));
    if (version.content.settings?.v !== 3) throw new Error('Synthetic V3 settings required');
    policy = structuredClone(version.content.settings.livePolicy);
    const participation = new Map(
      version.content.participation.map((entry) => [entry.positionId, entry.bidParticipation]),
    );
    const body = BidSessionPolicySnapshotSchema.parse({
      v: 3,
      ruleBookVersion: version.row.rule_book_version,
      ruleBookRevision: version.row.rule_book_revision,
      positionTemplateVersion: version.row.position_template_version,
      configurationRevision: version.row.version_number,
      settings: version.content.settings,
      credentialEvaluationOn: '2027-01-01',
      capturedAtMs: NOW,
      members: [
        {
          memberId: MEMBER,
          pool: 'FF',
          rscSeniority: 1,
          rankSeniority: 1,
          exclusionReason: null,
          authoritativeAssignmentId: null,
          rank: 'FF',
          isProbationary: false,
          credentialNames: ['Synthetic qualification'],
        },
      ],
      ruleBookMaterial: {
        v: 1,
        rules: version.content.rules.map((rule) => ({
          positionId: rule.positionId,
          requiredCriteriaJson: rule.requiredCriteriaJson,
          pointsPreferenceJson: rule.pointsPreferenceJson,
          tieBreakChainJson: rule.tieBreakChainJson,
          ruleBookVersion: version.row.rule_book_version,
          templateVersion: version.row.position_template_version,
        })),
        positions: version.content.positions.map((position) => ({
          ...position,
          templateVersion: version.row.position_template_version,
          bidParticipation: participation.get(position.id) ?? 'BIDDABLE',
        })),
      },
    });
    if (body.v !== 3) throw new Error('Synthetic V3 snapshot required');
    const evaluationPolicy = {
      bidYear: 2027,
      settings: version.content.settings,
      coverage: evaluateRuleBookCoverage({
        ruleBookVersion: body.ruleBookVersion,
        declaredTemplateVersion: body.positionTemplateVersion,
        rules: body.ruleBookMaterial.rules,
        positions: body.ruleBookMaterial.positions,
      }),
      bindings: [
        {
          positionId: ORIGIN,
          staffingPositionId: 'source-staffing',
          reviewStatus: 'approved' as const,
          authoritativeSourceRef: 'synthetic:source-binding',
        },
        {
          positionId: SEAT,
          staffingPositionId: 'target-staffing',
          reviewStatus: 'approved' as const,
          authoritativeSourceRef: 'synthetic:target-binding',
        },
        {
          positionId: PRIOR_SEAT,
          staffingPositionId: 'second-staffing',
          reviewStatus: 'approved' as const,
          authoritativeSourceRef: 'synthetic:second-binding',
        },
      ],
      ruleBookMaterial: body.ruleBookMaterial,
      sourceDecisions: [],
      policyReferenceJson: [],
    };
    const evaluationEvidence = await loadBidEvaluationEvidence(getDb(h.env.DB), 2027);
    prepareAgain = (mode) =>
      prepareCapturedBidEvaluation(
        getDb(h.env.DB),
        evaluationPolicy,
        evaluationEvidence,
        NOW,
        mode,
      );
    const prepared = await prepareAgain('mock');
    if (!prepared.ok) throw new Error(JSON.stringify(prepared));
    body.members = prepared.evaluation.members;
    body.tenureEvidence = prepared.evaluation.tenureEvidence;
    snapshot = {
      ...body,
      bidDefinition: {
        v: 1,
        bidSessionId: SESSION,
        bidYear: 2027,
        versionId: version.row.id,
        versionSha256: version.sha256,
        contextSha256: bidDefinitionContextHash(body),
      },
    };
    const json = JSON.stringify(snapshot);
    h.sqlite
      .prepare(`INSERT INTO bid_sessions
      (id,bid_year,started_at,current_phase,is_mock,turn_timer_seconds,expected_duration_days,config_json)
      VALUES (?,2027,?,'position_bid',?,180,2,?)`)
      .run(SESSION, NOW, 0, JSON.stringify(snapshot.settings));
    h.sqlite
      .prepare(`INSERT INTO bid_session_policy_snapshots
      (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at,
       bid_version_id,bid_version_sha256,snapshot_sha256,context_sha256)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(
        SESSION,
        snapshot.ruleBookVersion,
        snapshot.positionTemplateVersion,
        snapshot.ruleBookRevision,
        json,
        NOW,
        version.row.id,
        version.sha256,
        digest(json),
        snapshot.bidDefinition.contextSha256,
      );
    expect(await loadBidSessionPolicySnapshot(getDb(h.env.DB), SESSION)).toEqual({
      snapshot,
      error: null,
    });
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    state = {
      ...emptyBidSessionState(SESSION),
      currentPhase: 'position_bid',
      currentBidderId: MEMBER,
      turnStartedAtMs: NOW,
      lastSeq: 7,
      bidOrder: [
        { ordinal: 1, memberId: MEMBER, pool: 'FF', stageId: 'synthetic-ff' },
        { ordinal: 2, memberId: SECOND, pool: 'FF', stageId: 'synthetic-ff' },
      ],
    };
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  function commit(suppliedCommand?: LiveBidCommand) {
    const command: LiveBidCommand = suppliedCommand ?? {
      v: 1,
      type: commandType,
      commandId: KEY,
      bidSessionId: SESSION,
      expectedSeq: 7,
      actor: { id: MEMBER, role: 'admin' },
      reason: 'Synthetic frozen eligibility regression only',
      evidenceReference: 'synthetic-nonprobationary-rule',
      memberId: MEMBER,
      positionId: SEAT,
    };
    return commitLiveBidCommand({
      db: h.env.DB,
      state,
      command,
      policy,
      nowMs: () => NOW + 1000,
      newId: () => `synthetic-eligibility-evidence-${++nextId}`,
    });
  }

  const election = {
    assignmentId: 'source-assignment',
    memberConfirmed: true as const,
    evidenceReference: 'synthetic:recorded-member-choice',
  };
  function choice(extra: Record<string, unknown> = {}): LiveBidCommand {
    return {
      v: 1,
      type: 'live.record_selection',
      commandId: KEY,
      bidSessionId: SESSION,
      expectedSeq: 7,
      actor: { id: MEMBER, role: 'admin' },
      reason: 'Synthetic explicitly elected term departure',
      evidenceReference: null,
      memberId: MEMBER,
      positionId: SEAT,
      aDay: 'G1',
      ...extra,
    } as LiveBidCommand;
  }
  function storedAwards() {
    return {
      canonical: h.sqlite.prepare('SELECT * FROM canonical_bid_session_state').all(),
      events: h.sqlite.prepare('SELECT * FROM bid_command_events').all(),
      outbox: h.sqlite.prepare('SELECT * FROM bid_audit_outbox').all(),
      legacy: h.sqlite.prepare('SELECT * FROM bids').all(),
      assignments: h.sqlite.prepare('SELECT * FROM member_assignments').all(),
    };
  }
  async function transition(path: string, init: RequestInit = {}) {
    const token = await signJwt(
      {
        sub: MEMBER,
        emp: 'synthetic-command-editor',
        role: 'admin',
        rank: 'FF',
        first_name: 'Synthetic',
        last_name: 'Member',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
    return app.fetch(
      new Request(`http://x/api/admin/bid-award-transition/${SESSION}/${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      }),
      h.env,
    );
  }
  async function complete() {
    expect(
      (
        await commit(
          choice(
            snapshot.members.some((member) => member.termParticipation)
              ? { termDeparture: election }
              : {},
          ),
        )
      ).result,
    ).toMatchObject({
      kind: 'accepted',
    });
    expect(
      (
        await commit(
          choice({
            commandId: 'b0ca50cb-c2e7-4282-b8f8-f6db206fc42e',
            expectedSeq: 8,
            memberId: SECOND,
            positionId: PRIOR_SEAT,
            aDay: 'G2',
          }),
        )
      ).result,
    ).toMatchObject({ kind: 'accepted' });
    const final = await commit({
      v: 1,
      type: 'live.complete_session',
      commandId: '878d6c34-cc0e-420f-a21b-ea0b8bfd27b9',
      bidSessionId: SESSION,
      expectedSeq: 9,
      actor: { id: MEMBER, role: 'admin' },
      reason: 'Synthetic official completion',
      evidenceReference: null,
    });
    expect(final.result, JSON.stringify(final.result)).toMatchObject({ kind: 'accepted' });
  }

  it('compiles source service facts into voluntary rights without reopening the protected seat', () => {
    expect(snapshot.members.find((m) => m.memberId === MEMBER)).toMatchObject({
      pool: 'FF',
      exclusionReason: null,
      termParticipation: {
        assignmentId: 'source-assignment',
        memberMayLeave: true,
        voluntaryOnly: true,
        protected: true,
        evidenceId: 'source-term-evidence',
        evidenceRevision: 1,
      },
    });
    expect(snapshot.ruleBookMaterial.positions.find((p) => p.id === ORIGIN)?.bidParticipation).toBe(
      'ADMIN_ASSIGNED_NON_BIDDABLE',
    );
    expect(snapshot.members.find((m) => m.memberId === SECOND)?.termParticipation).toBeUndefined();
  });

  it('carries missing tenure facts only as a Mock rehearsal assumption', async () => {
    expect(await prepareAgain('mock')).toMatchObject({ ok: true });
    expect(await prepareAgain('participant_preview')).toMatchObject({ ok: true });
    expect(await prepareAgain('live')).toMatchObject({
      ok: false,
      code: 'assignment_term_evidence_requires_review',
      positionIds: [ORIGIN],
      termIssues: [{ positionId: ORIGIN, code: 'term_evidence_required' }],
    });
    expect(snapshot.members.find((member) => member.memberId === MEMBER)).toMatchObject({
      pool: 'EXCLUDED',
      exclusionReason: 'ADMIN_ASSIGNED_NON_BIDDABLE',
    });
    expect(snapshot.members.find((member) => member.memberId === MEMBER)?.termParticipation).toBe(
      undefined,
    );
  });

  it.each([
    ['missing consent', {}, 'TERM_DEPARTURE_ELECTION_REQUIRED'],
    [
      'wrong assignment',
      { termDeparture: { ...election, assignmentId: 'different' } },
      'TERM_DEPARTURE_ASSIGNMENT_MISMATCH',
    ],
    [
      'false consent',
      { termDeparture: { ...election, memberConfirmed: false } },
      'TERM_DEPARTURE_ELECTION_REQUIRED',
    ],
    ['force', { type: 'live.force_selection' }, 'TERM_DEPARTURE_VOLUNTARY_ONLY'],
  ] as const)('rejects %s without award or assignment mutation', async (_label, change, code) => {
    const before = storedAwards();
    expect((await commit(choice(change))).result).toMatchObject({ kind: 'rejected', code });
    expect(storedAwards()).toEqual(before);
  });

  it('requires fresh consent on amendment and keeps source assignment intact until transition', async () => {
    const first = await commit(choice({ termDeparture: election }));
    expect(first.result).toMatchObject({ kind: 'accepted' });
    expect(first.canonicalState?.fills[SEAT]?.termDeparture).toMatchObject({
      ...election,
      actorMemberId: MEMBER,
      commandId: KEY,
      recordedAtMs: NOW + 1000,
    });
    const amendment: LiveBidCommand = {
      v: 1,
      type: 'live.amend_selection',
      commandId: 'd85de948-7a9f-40e6-a9a3-2468a8e0beb6',
      bidSessionId: SESSION,
      expectedSeq: 8,
      actor: { id: MEMBER, role: 'admin' },
      reason: 'Synthetic amendment choice',
      evidenceReference: null,
      memberId: MEMBER,
      fromPositionId: SEAT,
      toPositionId: PRIOR_SEAT,
      aDay: 'G2',
    };
    const before = storedAwards();
    expect((await commit(amendment)).result).toMatchObject({
      kind: 'rejected',
      code: 'TERM_DEPARTURE_ELECTION_REQUIRED',
    });
    expect(storedAwards()).toEqual(before);
    const amended = await commit({
      ...amendment,
      commandId: 'e6bf09cf-e218-438a-ae5c-6b965ef27dcc',
      termDeparture: election,
    });
    expect(amended.result).toMatchObject({ kind: 'accepted' });
    expect(amended.canonicalState?.fills[SEAT]).toBeUndefined();
    expect(amended.canonicalState?.fills[PRIOR_SEAT]?.termDeparture?.commandId).toBe(
      'e6bf09cf-e218-438a-ae5c-6b965ef27dcc',
    );
    expect(
      h.sqlite
        .prepare("SELECT effective_to FROM member_assignments WHERE id='source-assignment'")
        .get(),
    ).toEqual({ effective_to: null });
  });

  it('a pass preserves protected retention without manufacturing an award or election', async () => {
    expect(
      (
        await commit({
          v: 1,
          type: 'live.disposition',
          commandId: KEY,
          bidSessionId: SESSION,
          expectedSeq: 7,
          actor: { id: MEMBER, role: 'admin' },
          reason: 'Member chooses to retain appointment',
          evidenceReference: null,
          disposition: 'PASS',
        })
      ).result,
    ).toMatchObject({ kind: 'accepted' });
    expect(
      h.sqlite
        .prepare("SELECT effective_to FROM member_assignments WHERE id='source-assignment'")
        .get(),
    ).toEqual({ effective_to: null });
    expect(h.sqlite.prepare('SELECT state_json FROM canonical_bid_session_state').get()).toEqual({
      state_json: expect.not.stringContaining('termDeparture'),
    });
  });

  it('applies and replays canonical completion directly without legacy mirrors or reopening the source', async () => {
    await complete();
    const before = h.sqlite.serialize();
    const preview = await transition('preview?effective_on=2027-02-01');
    expect(preview.status, await preview.clone().text()).toBe(200);
    expect(h.sqlite.serialize().every((byte, index) => byte === before[index])).toBe(true);
    const init = {
      method: 'POST',
      headers: { 'Idempotency-Key': 'synthetic-term-transition' },
      body: JSON.stringify({
        effective_on: '2027-02-01',
        reason: 'Synthetic approved voluntary transition',
      }),
    };
    const applied = await transition('apply', init);
    expect(applied.status, await applied.clone().text()).toBe(201);
    expect(
      h.sqlite
        .prepare("SELECT effective_to FROM member_assignments WHERE id='source-assignment'")
        .get(),
    ).toEqual({ effective_to: '2027-01-31' });
    expect(
      h.sqlite
        .prepare(
          "SELECT member_id,staffing_position_id,effective_from,status FROM member_assignments WHERE origin_type='BID_AWARD' ORDER BY member_id",
        )
        .all(),
    ).toEqual([
      {
        member_id: MEMBER,
        staffing_position_id: 'target-staffing',
        effective_from: '2027-02-01',
        status: 'planned',
      },
      {
        member_id: SECOND,
        staffing_position_id: 'second-staffing',
        effective_from: '2027-02-01',
        status: 'planned',
      },
    ]);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bids').get()).toEqual({ n: 0 });
    expect(snapshot.ruleBookMaterial.positions.find((p) => p.id === ORIGIN)?.bidParticipation).toBe(
      'ADMIN_ASSIGNED_NON_BIDDABLE',
    );
    const after = h.sqlite.serialize();
    expect(await (await transition('apply', init)).json()).toMatchObject({ replayed: true });
    expect(h.sqlite.serialize().every((byte, index) => byte === after[index])).toBe(true);
  });

  it('fails closed if the exact source assignment changes after completion', async () => {
    await complete();
    h.sqlite
      .prepare(
        "UPDATE member_assignments SET effective_to='2027-03-01' WHERE id='source-assignment'",
      )
      .run();
    const before = h.sqlite.serialize();
    const response = await transition('preview?effective_on=2027-02-01');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'term_departure_source_assignment_changed',
    });
    expect(h.sqlite.serialize().every((byte, index) => byte === before[index])).toBe(true);
  });

  it('applies an unchanged finite term source without a closure mutation', async () => {
    await complete();
    const response = await transition('apply', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'synthetic-finite-term-transition' },
      body: JSON.stringify({
        effective_on: '2027-02-01',
        reason: 'Synthetic finite source transition',
      }),
    });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(
      h.sqlite
        .prepare("SELECT effective_to FROM member_assignments WHERE id='source-assignment'")
        .get(),
    ).toEqual({ effective_to: '2027-01-15' });
    expect(
      h.sqlite
        .prepare("SELECT count(*) AS n FROM member_assignments WHERE origin_type='BID_AWARD'")
        .get(),
    ).toEqual({ n: 2 });
  });

  it.each([
    ['status', "status='ended'"],
    ['staffing position', "staffing_position_id='second-staffing'"],
    ['end date', "effective_to='2027-01-16'"],
  ])(
    'atomically rejects a finite term source %s race without persisting transition writes',
    async (_field, update) => {
      await complete();
      const lifecycleBefore = h.sqlite.prepare('SELECT * FROM personnel_lifecycle_events').all();
      const auditBefore = h.sqlite.prepare('SELECT * FROM audit_log').all();
      let raced: ReturnType<typeof storedAwards> | undefined;
      const batch = h.env.DB.batch.bind(h.env.DB);
      const batchSpy = vi.spyOn(h.env.DB, 'batch').mockImplementationOnce(async (statements) => {
        // This is an independent committed edit after all context reads, just
        // before the real transaction starts. The edit itself must be retained.
        h.sqlite
          .prepare(`UPDATE member_assignments SET ${update} WHERE id='source-assignment'`)
          .run();
        raced = storedAwards();
        return batch(statements);
      });
      const response = await transition('apply', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'synthetic-finite-source-race' },
        body: JSON.stringify({
          effective_on: '2027-02-01',
          reason: 'Synthetic source race protection',
        }),
      });
      expect(batchSpy).toHaveBeenCalledOnce();
      expect(response.status, await response.clone().text()).toBe(409);
      expect(raced).toBeDefined();
      expect(storedAwards()).toEqual(raced);
      expect(h.sqlite.prepare('SELECT * FROM personnel_lifecycle_events').all()).toEqual(
        lifecycleBefore,
      );
      expect(h.sqlite.prepare('SELECT * FROM audit_log').all()).toEqual(auditBefore);
    },
  );

  it('transitions ordinary preexisting canonical awards without term rights or legacy mirrors', async () => {
    expect(snapshot.members.every((member) => member.termParticipation === undefined)).toBe(true);
    await complete();
    const response = await transition('apply', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'synthetic-ordinary-canonical' },
      body: JSON.stringify({
        effective_on: '2027-02-01',
        reason: 'Synthetic ordinary canonical transition',
      }),
    });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(
      h.sqlite
        .prepare("SELECT count(*) AS n FROM member_assignments WHERE origin_type='BID_AWARD'")
        .get(),
    ).toEqual({ n: 2 });
    expect(h.sqlite.prepare('SELECT count(*) AS n FROM bids').get()).toEqual({ n: 0 });
  });

  it.each([
    ['rank', 'LT'],
    ['employment_status', 'retired'],
  ] as const)(
    'rejects a concurrent member %s change before writing stale lifecycle evidence',
    async (field, value) => {
      await complete();
      const lifecycleBefore = h.sqlite.prepare('SELECT * FROM personnel_lifecycle_events').all();
      const auditBefore = h.sqlite.prepare('SELECT * FROM audit_log').all();
      const assignmentsBefore = h.sqlite.prepare('SELECT * FROM member_assignments').all();
      const batch = h.env.DB.batch.bind(h.env.DB);
      vi.spyOn(h.env.DB, 'batch').mockImplementationOnce(async (statements) => {
        h.sqlite.prepare(`UPDATE members SET ${field}=? WHERE id=?`).run(value, SECOND);
        return batch(statements);
      });
      const response = await transition('apply', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'synthetic-member-state-race' },
        body: JSON.stringify({
          effective_on: '2027-02-01',
          reason: 'Synthetic concurrent personnel review',
        }),
      });
      expect(response.status, await response.clone().text()).toBe(409);
      expect(h.sqlite.prepare('SELECT * FROM personnel_lifecycle_events').all()).toEqual(
        lifecycleBefore,
      );
      expect(h.sqlite.prepare('SELECT * FROM audit_log').all()).toEqual(auditBefore);
      expect(h.sqlite.prepare('SELECT * FROM member_assignments').all()).toEqual(assignmentsBefore);
      expect(
        h.sqlite.prepare(`SELECT ${field} AS value FROM members WHERE id=?`).get(SECOND),
      ).toEqual({ value });
    },
  );

  it.each(['PROMOTION', 'RETIREMENT'] as const)(
    'never lets an assignment transition overwrite scheduled personnel %s',
    async (kind) => {
      await complete();
      h.sqlite
        .prepare(`INSERT INTO personnel_lifecycle_events
      (id,member_id,kind,effective_on,employment_status_before,employment_status_after,rank_before,rank_after,
       reason,origin,actor_subject,idempotency_key,before_state,after_state,created_at)
      VALUES ('synthetic-scheduled-promotion',?,?,'2027-01-15','active',?,'FF',?,
       'Synthetic previously reviewed promotion','ADMIN','10001','synthetic-promotion',
       '{"rank":"FF","employmentStatus":"active"}','{"rank":"LT","employmentStatus":"active"}',?)`)
        .run(
          SECOND,
          kind,
          kind === 'RETIREMENT' ? 'retired' : 'active',
          kind === 'PROMOTION' ? 'LT' : 'FF',
          NOW,
        );
      const response = await transition('apply', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'synthetic-scheduled-promotion-transition' },
        body: JSON.stringify({
          effective_on: '2027-02-01',
          reason: 'Synthetic assignment-only transition',
        }),
      });
      expect(response.status, await response.clone().text()).toBe(201);
      const events = h.sqlite
        .prepare(`SELECT id,kind,effective_on AS effectiveOn,
      employment_status_after AS employmentStatusAfter,rank_after AS rankAfter,separation_type AS separationType,
      before_state AS beforeState,created_at AS createdAt FROM personnel_lifecycle_events WHERE member_id=?`)
        .all(SECOND) as PersonnelLifecycleProjectionEvent[];
      const projected = derivePersonnelMemberAsOf(
        {
          id: SECOND,
          employeeId: 'synthetic-second',
          firstName: 'Synthetic',
          lastName: 'Second',
          rank: 'FF',
          employmentStatus: 'active',
          employmentStatusEffectiveOn: '2026-01-01',
          separationType: null,
        },
        events,
        '2027-02-01',
      );
      expect(projected.rank).toBe(kind === 'PROMOTION' ? 'LT' : 'FF');
      expect(projected.employmentStatus).toBe(kind === 'RETIREMENT' ? 'retired' : 'active');
      expect(
        h.sqlite
          .prepare(
            "SELECT rank_after,employment_status_after FROM personnel_lifecycle_events WHERE origin='BID' AND member_id=?",
          )
          .get(SECOND),
      ).toEqual({ rank_after: null, employment_status_after: null });
    },
  );

  it('requires explicit consent for specialty acceptance and binds its immutable event election', async () => {
    // The requester is the lower-priority member; the protected term holder
    // receives an actual higher-priority offer rather than a self-interruption.
    state.currentBidderId = SECOND;
    state.queueCursor = 1;
    const started = await commit({
      v: 1,
      type: 'live.start_specialty_adjudication',
      commandId: KEY,
      bidSessionId: SESSION,
      expectedSeq: 7,
      actor: { id: MEMBER, role: 'admin' },
      reason: 'Synthetic specialty offer',
      evidenceReference: null,
      specialtyId: 'synthetic-specialty',
      positionId: SEAT,
      candidateMemberIds: [MEMBER],
    });
    expect(started.result).toMatchObject({ kind: 'accepted' });
    const acceptance: LiveBidCommand = {
      v: 1,
      type: 'live.resolve_specialty_candidate',
      commandId: 'f776ae84-830c-4c1e-a635-783670baf6ef',
      bidSessionId: SESSION,
      expectedSeq: 8,
      actor: { id: MEMBER, role: 'admin' },
      reason: 'Synthetic specialty choice',
      evidenceReference: null,
      memberId: MEMBER,
      outcome: 'ACCEPT',
      aDay: 'G1',
    };
    const before = storedAwards();
    expect((await commit(acceptance)).result).toMatchObject({
      kind: 'rejected',
      code: 'TERM_DEPARTURE_ELECTION_REQUIRED',
    });
    expect(storedAwards()).toEqual(before);
    const accepted = await commit({
      ...acceptance,
      commandId: '628dbd67-1897-4f99-84a6-4e51eef9d3ea',
      termDeparture: election,
    });
    expect(accepted.result).toMatchObject({ kind: 'accepted' });
    expect(accepted.canonicalState?.fills[SEAT]?.termDeparture).toMatchObject({
      ...election,
      commandId: '628dbd67-1897-4f99-84a6-4e51eef9d3ea',
    });
  });

  it('rolls back canonical future assignment writes when the final transaction cannot commit', async () => {
    await complete();
    const before = storedAwards();
    h.failNextBatchAt(3);
    const response = await transition('apply', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'synthetic-rollback' },
      body: JSON.stringify({ effective_on: '2027-02-01', reason: 'Synthetic rollback protection' }),
    });
    expect(response.status).toBe(409);
    expect(storedAwards()).toEqual(before);
  });
});
