import { createHash } from 'node:crypto';
import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  type LiveBidCommand,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitLiveBidCommand,
  loadCanonicalBidSessionState,
} from '../../src/commands/canonical-command-service.js';
import { getDb } from '../../src/db/index.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { app } from '../../src/index.js';
import { projectCanonicalMockCompletion } from '../../src/lib/annual-completion-result.js';
import { bidDefinitionContextHash } from '../../src/lib/bid-definition-context.js';
import type { PinnedBidSessionPolicySnapshot } from '../../src/lib/bid-definition-pin.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import { loadBidSessionPolicySnapshot } from '../../src/lib/bid-policy.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

// Synthetic engineering fixture: an unreachable Captain returns after the
// Captain stage and keeps Captain-stage rights through the canonical boundary.
const SESSION = 'synthetic-returned-member-session';
const NOW = Date.parse('2027-01-01T10:00:00.000Z');
const CPT_A = 10001;
const CPT_B = 10002;
const LT_A = 10003;
const LT_B = 10004;
const SEATS = [
  ['synthetic-c1', 'CPT'],
  ['synthetic-c2', 'CPT'],
  ['synthetic-l1', 'LT'],
  ['synthetic-l2', 'LT'],
] as const;
const RETAINS = new Set(['UNREACHABLE', 'DEFER']);
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function syntheticPolicy() {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-returned-member-policy',
    stages: [
      {
        id: 'captains',
        label: 'Captains',
        order: 0,
        memberIds: [CPT_A, CPT_B],
        opportunityPositionIds: ['synthetic-c1', 'synthetic-c2'],
        kind: 'CAPTAIN',
      },
      {
        id: 'lieutenants',
        label: 'Lieutenants',
        order: 1,
        memberIds: [LT_A, LT_B],
        opportunityPositionIds: ['synthetic-l1', 'synthetic-l2'],
        kind: 'LIEUTENANT',
      },
    ],
    dispositions: BidDispositionSchema.options.map((disposition) => ({
      disposition,
      advances: disposition !== 'HOLD',
      returns: false,
      returnStageId: null,
      retainsLaterSelectionRights: RETAINS.has(disposition),
      terminal: false,
      requiresReason: true,
      requiresEvidence: false,
      contactPolicyReference: null,
    })),
    actionPermissions: LiveBidActionSchema.options.map((action) => ({
      action,
      actorMemberIds: [CPT_A],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
    annualOperations: {
      v: 1,
      stageOrder: ['captains', 'lieutenants'],
      requiredTopologyPositionIds: SEATS.map(([id]) => id),
      specialties: [],
      contact: { minimumAttempts: null, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: null,
        max: null,
        captainDcMax: null,
        specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
        execution: {
          timing: 'SIMULTANEOUS',
          officersPerGroup: null,
          sourceRef: 'synthetic:aday-policy',
          constraints: [],
        },
      },
    },
  });
}

describe('canonical returned member and completion coverage', () => {
  let h: TestD1;
  let snapshot: PinnedBidSessionPolicySnapshot;
  let policy: FrozenLiveBidPolicy;
  let state: BidSessionState;
  let nextId: number;
  let commandCounter: number;

  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    nextId = 0;
    commandCounter = 0;
    const settings = {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      personnelEvaluationOn: '2027-01-01',
      livePolicy: syntheticPolicy(),
    };
    h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
        VALUES (${CPT_A},'synthetic-cpt-a','Synthetic','CaptainA','CPT','OFC',1,1,1),
          (${CPT_B},'synthetic-cpt-b','Synthetic','CaptainB','CPT','OFC',2,1,1),
          (${LT_A},'synthetic-lt-a','Synthetic','LieutenantA','LT','OFC',3,1,1),
          (${LT_B},'synthetic-lt-b','Synthetic','LieutenantB','LT','OFC',4,1,1);
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic topology');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',4,'Synthetic rules');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision)
        VALUES (2027,'configuring','2027.1','2027.1',3);
    `);
    for (const [id, rank] of SEATS) {
      h.sqlite
        .prepare(`INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
          VALUES (?,'2027.1','A','7','Combat','Synthetic Engine',?,?)`)
        .run(id, rank, id);
      h.sqlite
        .prepare(`INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
          VALUES ('2027.1',?,'2027.1',?,'{"max":0,"items":[]}','["rsc_seniority"]')`)
        .run(id, JSON.stringify({ rank: [rank], credentials: [], custom: [] }));
    }
    h.sqlite
      .prepare('UPDATE bid_years SET config_json=? WHERE year=2027')
      .run(JSON.stringify(settings));
    const captured = await captureBidDefinitionSource(h.env.DB, 2027);
    if (!captured.ok) throw new Error(JSON.stringify(captured));
    const saved = await saveBidDefinition(h.env.DB, {
      year: 2027,
      key: 'synthetic-returned-member-adoption',
      actorSubject: 'synthetic-cpt-a',
      actorId: CPT_A,
      expected: { kind: 'legacy', sourceToken: captured.sourceToken },
      reason: 'Synthetic returned member fixture',
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
      members: [CPT_A, CPT_B, LT_A, LT_B].map((memberId) => ({
        memberId,
        pool: 'OFC',
        rscSeniority: memberId - 10000,
        rankSeniority: memberId - 10000,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: memberId <= CPT_B ? 'CPT' : 'LT',
        isProbationary: false,
        credentialNames: [],
        specialtyQualifications: [],
      })),
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
        VALUES (?,2027,?,'position_bid',1,180,2,?)`)
      .run(SESSION, NOW, JSON.stringify(snapshot.settings));
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
    state = {
      ...emptyBidSessionState(SESSION),
      currentPhase: 'position_bid',
      currentBidderId: CPT_A,
      turnStartedAtMs: NOW,
      bidOrder: [
        { ordinal: 1, memberId: CPT_A, pool: 'OFC', stageId: 'captains' },
        { ordinal: 2, memberId: CPT_B, pool: 'OFC', stageId: 'captains' },
        { ordinal: 3, memberId: LT_A, pool: 'OFC', stageId: 'lieutenants' },
        { ordinal: 4, memberId: LT_B, pool: 'OFC', stageId: 'lieutenants' },
      ],
      live: {
        currentStageId: 'captains',
        completedStageIds: [],
        pausedPhase: null,
        lastSelectionBidId: null,
        dispositions: [],
      },
      annual: {
        preferenceSheets: [],
        contactAttempts: [],
        unresolvedMemberIds: [],
        returnedAtCurrentSequence: [],
        returningMemberId: null,
        checkpoint: null,
        completion: null,
      },
    };
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  function common() {
    commandCounter += 1;
    return {
      v: 1 as const,
      commandId: `c2c2c2c2-0b60-4dcc-aa6b-${String(commandCounter).padStart(12, '0')}`,
      bidSessionId: SESSION,
      expectedSeq: state.lastSeq,
      actor: { id: CPT_A, role: 'admin' as const },
      reason: 'Synthetic returned member regression',
      evidenceReference: 'synthetic:returned-member',
    };
  }
  async function apply(command: LiveBidCommand) {
    const result = await commitLiveBidCommand({
      db: h.env.DB,
      state,
      command,
      policy,
      nowMs: () => NOW + 1000 * (commandCounter + 1),
      newId: () => `synthetic-returned-member-${++nextId}`,
    });
    if (result.canonicalState) state = result.canonicalState;
    return result;
  }
  const select = (memberId: number, positionId: string, aDay: string) =>
    apply({
      ...common(),
      type: 'live.record_selection',
      memberId,
      positionId,
      aDay,
    } as LiveBidCommand);
  const accepted = async (promise: ReturnType<typeof apply>) =>
    expect((await promise).result.kind).toBe('accepted');

  async function operatorReadback() {
    const key = 'synthetic-returned-member-jwt-key'.repeat(3);
    const token = await signJwt(
      {
        sub: CPT_A,
        emp: 'synthetic-cpt-a',
        role: 'admin',
        rank: 'CPT',
        first_name: 'Synthetic',
        last_name: 'CaptainA',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      key,
    );
    const response = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${SESSION}/specialty-live`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: key },
    );
    expect(response.status).toBe(200);
    return response.json();
  }

  it('restores a returned Captain to an open Captain seat during the Lieutenant stage', async () => {
    await accepted(apply({ ...common(), type: 'live.disposition', disposition: 'UNREACHABLE' }));
    await accepted(select(CPT_B, 'synthetic-c1', 'G1'));
    expect(state).toMatchObject({ currentBidderId: LT_A, currentPhase: 'position_bid' });
    const beforeReturn = state.lastSeq;
    await accepted(
      apply({ ...common(), type: 'live.return_at_current_sequence', memberId: CPT_A }),
    );
    expect(await operatorReadback()).toMatchObject({
      current_bidder: { member_id: LT_A },
      returning_member: { member_id: CPT_A },
      selection_stage: { id: 'captains', eligible_position_ids: ['synthetic-c2'] },
    });
    const stale = await apply({
      ...common(),
      expectedSeq: beforeReturn,
      type: 'live.record_selection',
      memberId: CPT_A,
      positionId: 'synthetic-c2',
      aDay: 'G2',
    } as LiveBidCommand);
    expect(stale.result).toMatchObject({ kind: 'rejected', code: 'STALE_SEQUENCE' });
    expect(await loadCanonicalBidSessionState(h.env.DB, SESSION)).toEqual(state);
    await accepted(select(CPT_A, 'synthetic-c2', 'G2'));
    expect(state).toMatchObject({ currentBidderId: LT_A, queueCursor: 2 });
    expect(state.fills['synthetic-c2']).toMatchObject({ memberId: CPT_A, aDay: 'G2' });
    await accepted(select(LT_A, 'synthetic-l1', 'G3'));
    await accepted(select(LT_B, 'synthetic-l2', 'G4'));
    await accepted(apply({ ...common(), type: 'live.complete_session' }));
    const completion = state.annual?.completion;
    if (!completion) throw new Error('completion required');
    const projected = projectCanonicalMockCompletion({
      session: { id: SESSION, mode: 'MOCK', bidYear: 2027 },
      completion: {
        commandId: 'synthetic-completion',
        revision: state.lastSeq,
        completedAtMs: completion.readyForFinalizationAtMs,
        receiptIntegrity: 'VERIFIED',
      },
      frozen: {
        ruleBookVersion: snapshot.ruleBookVersion,
        topologyReference: snapshot.positionTemplateVersion,
        staffingReference: 'synthetic',
        members: snapshot.members.map((member) => ({
          memberId: member.memberId,
          rank: member.rank,
        })),
        positions: SEATS.map(([id]) => ({
          id,
          shift: 'A' as const,
          station: '7',
          unit: 'Synthetic Engine',
          position: id,
          specialty: null,
        })),
      },
      state,
      amendmentLinks: [],
    });
    expect(projected).toMatchObject({ ok: true });
    if (!projected.ok) return;
    expect(
      projected.value.participants.map((entry) => [entry.memberId, entry.positionId, entry.aDay]),
    ).toEqual([
      [CPT_B, 'synthetic-c1', 'G1'],
      [CPT_A, 'synthetic-c2', 'G2'],
      [LT_A, 'synthetic-l1', 'G3'],
      [LT_B, 'synthetic-l2', 'G4'],
    ]);
  });

  it('rejects completion until a member returning after queue exhaustion is resolved', async () => {
    await accepted(apply({ ...common(), type: 'live.disposition', disposition: 'UNREACHABLE' }));
    await accepted(select(CPT_B, 'synthetic-c1', 'G1'));
    await accepted(select(LT_A, 'synthetic-l1', 'G3'));
    await accepted(select(LT_B, 'synthetic-l2', 'G4'));
    expect(state).toMatchObject({ currentPhase: 'complete', currentBidderId: null });
    const unresolved = await apply({ ...common(), type: 'live.complete_session' });
    expect(unresolved.result).toMatchObject({
      kind: 'rejected',
      code: 'UNRESOLVED_MEMBERS_BLOCK_COMPLETION',
    });
    await accepted(
      apply({ ...common(), type: 'live.return_at_current_sequence', memberId: CPT_A }),
    );
    const uncovered = await apply({ ...common(), type: 'live.complete_session' });
    expect(uncovered.result).toMatchObject({
      kind: 'rejected',
      code: 'PARTICIPANT_COVERAGE_INCOMPLETE',
    });
    await accepted(select(CPT_A, 'synthetic-c2', 'G2'));
    expect(state.currentPhase).toBe('complete');
    await accepted(apply({ ...common(), type: 'live.complete_session' }));
    expect(state.annual?.completion).not.toBeNull();
    expect(h.sqlite.prepare('SELECT count(*) AS count FROM bids').get()).toEqual({ count: 0 });
  });

  it('restores the final-stage Lieutenant after exhaustion and shows their open seat after restart', async () => {
    await accepted(select(CPT_A, 'synthetic-c1', 'G1'));
    await accepted(select(CPT_B, 'synthetic-c2', 'G2'));
    await accepted(apply({ ...common(), type: 'live.disposition', disposition: 'UNREACHABLE' }));
    await accepted(select(LT_B, 'synthetic-l2', 'G4'));
    expect(state.currentPhase).toBe('complete');
    const returnCommand: LiveBidCommand = {
      ...common(),
      type: 'live.return_at_current_sequence',
      memberId: LT_A,
    };
    const returned = await apply(returnCommand);
    expect(returned.result.kind).toBe('accepted');
    const restarted = await loadCanonicalBidSessionState(h.env.DB, SESSION);
    if (!restarted) throw new Error('Persisted state required');
    state = restarted;
    expect(await operatorReadback()).toMatchObject({
      current_phase: 'complete',
      returning_member: { member_id: LT_A },
      selection_stage: { id: 'lieutenants', eligible_position_ids: ['synthetic-l1'] },
    });
    expect(await apply(returnCommand)).toEqual(returned);
    expect(
      (await apply({ ...common(), type: 'live.return_at_current_sequence', memberId: LT_A }))
        .result,
    ).toMatchObject({ kind: 'rejected', code: 'MEMBER_NOT_UNRESOLVED' });
    await accepted(select(LT_A, 'synthetic-l1', 'G3'));
    expect(state).toMatchObject({
      currentPhase: 'complete',
      annual: { returningMemberId: null, unresolvedMemberIds: [] },
    });
    await accepted(apply({ ...common(), type: 'live.complete_session' }));
    expect(await loadCanonicalBidSessionState(h.env.DB, SESSION)).toEqual(state);
    expect(await loadBidSessionPolicySnapshot(getDb(h.env.DB), SESSION)).toEqual({
      snapshot,
      error: null,
    });
  });

  it('rejects position return for an awarded member with persisted legacy unresolved contact', async () => {
    state.fills['synthetic-c1'] = {
      memberId: CPT_A,
      ordinal: 1,
      bidId: 'synthetic-legacy-award',
      aDay: 'G1',
    };
    state.queueCursor = 1;
    state.currentBidderId = CPT_B;
    if (!state.annual) throw new Error('Annual fixture required');
    state.annual = { ...state.annual, unresolvedMemberIds: [CPT_A] };
    await accepted(
      apply({ ...common(), type: 'live.checkpoint', name: 'Synthetic legacy recovery checkpoint' }),
    );
    const beforeReturn = structuredClone(state);
    const restarted = await loadCanonicalBidSessionState(h.env.DB, SESSION);
    if (!restarted) throw new Error('Persisted state required');
    state = restarted;
    expect(
      (await apply({ ...common(), type: 'live.return_at_current_sequence', memberId: CPT_A }))
        .result,
    ).toMatchObject({ kind: 'rejected', code: 'MEMBER_NOT_UNRESOLVED' });
    expect(state).toEqual(beforeReturn);
    expect(await loadCanonicalBidSessionState(h.env.DB, SESSION)).toEqual(beforeReturn);
  });

  it('marks contact evidence for the returned member without changing the waiting bidder contact', async () => {
    await accepted(apply({ ...common(), type: 'live.disposition', disposition: 'UNREACHABLE' }));
    await accepted(select(CPT_B, 'synthetic-c1', 'G1'));
    await accepted(
      apply({ ...common(), type: 'live.record_contact_attempt', memberId: LT_A, method: 'PHONE' }),
    );
    await accepted(
      apply({ ...common(), type: 'live.return_at_current_sequence', memberId: CPT_A }),
    );
    await accepted(
      apply({ ...common(), type: 'live.record_contact_attempt', memberId: CPT_A, method: 'TEXT' }),
    );
    await accepted(apply({ ...common(), type: 'live.disposition', disposition: 'UNREACHABLE' }));
    expect(state).toMatchObject({
      currentBidderId: LT_A,
      annual: { returningMemberId: null, unresolvedMemberIds: [CPT_A] },
    });
    expect(
      h.sqlite
        .prepare('SELECT member_id, disposition FROM bid_contact_attempts ORDER BY member_id')
        .all(),
    ).toEqual([
      { member_id: CPT_A, disposition: 'UNREACHABLE' },
      { member_id: LT_A, disposition: 'RECORDED' },
    ]);
    expect(await loadCanonicalBidSessionState(h.env.DB, SESSION)).toEqual(state);
    await accepted(
      apply({ ...common(), type: 'live.return_at_current_sequence', memberId: CPT_A }),
    );
    expect(state.annual?.returningMemberId).toBe(CPT_A);
  });
});
