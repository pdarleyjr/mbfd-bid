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
import { bidDefinitionContextHash } from '../../src/lib/bid-definition-context.js';
import type { PinnedBidSessionPolicySnapshot } from '../../src/lib/bid-definition-pin.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import { loadBidSessionPolicySnapshot } from '../../src/lib/bid-policy.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const SESSION = 'synthetic-command-integrity-session';
const SEAT = 'synthetic-command-integrity-seat';
const PRIOR_SEAT = 'synthetic-prior-seat';
const POOL_FIRST = 'synthetic-z-pool-first';
const MEMBER = 10001;
const NOW = Date.parse('2027-01-01T10:00:00.000Z');
const KEY = 'b8619c19-0b60-4dcc-aa6b-eec70a733e65'; // gitleaks:allow -- synthetic command UUID, not an authentication secret
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
// Synthetic, schema-valid execution inputs only. The real store seals the
// definition; manually inserting a valid snapshot here does not publish a Bid
// or establish that this private draft is authorized to start Live execution.
function syntheticPolicy() {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-command-integrity-policy',
    stages: [
      {
        id: 'synthetic-ff',
        label: 'Synthetic firefighter stage',
        order: 0,
        memberIds: [MEMBER, MEMBER + 1, MEMBER + 2],
        opportunityPositionIds: [SEAT, PRIOR_SEAT, POOL_FIRST],
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
      requiredTopologyPositionIds: [SEAT, PRIOR_SEAT, POOL_FIRST],
      opportunityPools: [
        {
          id: 'synthetic-pool',
          label: 'Synthetic station pool',
          kind: 'STATION_POOL',
          sourceRef: 'Synthetic explicit pool decision',
          sourceDecisionId: 'synthetic-pool-decision',
          positionIds: [POOL_FIRST, PRIOR_SEAT],
        },
      ],
      specialties: [
        {
          id: 'synthetic-specialty',
          label: 'Synthetic specialty',
          mode: 'INTERRUPTING',
          opportunityPositionIds: [SEAT],
          requiredCredentialNames: [],
          requiredSpecialtyCodes: [],
          points: [],
          tieBreakChain: ['POINTS', 'RSC_SENIORITY'],
          scoring: {
            v: 1,
            total: [
              {
                id: 'binary',
                cap: null,
                excludesAny: ['IAAI'],
                items: [],
                preference: {
                  mode: 'BINARY_CUMULATIVE',
                  sourceRef: 'Synthetic secondary preference',
                  criteria: ['A', 'B', 'C'].map((credential) => ({
                    credential,
                    alternatives: [],
                    requiresAll: [],
                  })),
                },
              },
            ],
            so: [],
            mo: [],
            orderedPreference: {
              mode: 'ORDERED_QUALIFICATIONS',
              sourceRef: 'Synthetic primary qualification preference',
              criteria: [{ credential: 'IAAI', alternatives: [], requiresAll: [] }],
            },
          },
          rankingChannel: 'total',
        },
      ],
      contact: { minimumAttempts: 1, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 1,
        max: 2,
        captainDcMax: 1,
        specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
      },
    },
  });
}

describe('canonical ordered specialty priority', () => {
  const commandType = 'live.record_selection' as const;
  const isMock = true;
  let h: TestD1;
  let snapshot: PinnedBidSessionPolicySnapshot;
  let policy: FrozenLiveBidPolicy;
  let state: BidSessionState;
  let nextId: number;

  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    nextId = 0;
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
        VALUES (10001,'synthetic-command-editor','Synthetic','Editor','FF','FF',1,1,1),
          (10002,'synthetic-priority-one','Synthetic','First','FF','FF',2,1,1),
          (10003,'synthetic-priority-two','Synthetic','Second','FF','FF',3,1,1);
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
      .prepare(`INSERT INTO positions
        (id,template_version,shift,station,division,unit,rank_required,position_name)
        SELECT ? ,template_version,shift,station,division,'Synthetic Ladder',rank_required,'Synthetic capacity slot'
        FROM positions WHERE id=?`)
      .run(POOL_FIRST, PRIOR_SEAT);
    h.sqlite
      .prepare(`INSERT INTO position_rules
        (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        SELECT rule_book_version,?,template_version,required_criteria,points_preference,tie_break_chain
        FROM position_rules WHERE position_id=?`)
      .run(POOL_FIRST, PRIOR_SEAT);
    h.sqlite
      .prepare('UPDATE bid_years SET config_json=? WHERE year=2027')
      .run(JSON.stringify(settings));
    const captured = await captureBidDefinitionSource(h.env.DB, 2027);
    if (!captured.ok) throw new Error(JSON.stringify(captured));
    captured.content.sourceDecisions.push({
      issueId: 'synthetic-pool-decision',
      title: 'Synthetic capacity',
      question: 'Which capacity slots?',
      area: 'annual-policy',
      status: 'RESOLVED',
      decision: 'Synthetic slots are interchangeable.',
      sourceRef: 'Synthetic explicit pool decision',
      effectiveOn: '2027-01-01',
    });
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
          credentialNames: ['A', 'B', 'C'],
          specialtyQualifications: [],
        },
        ...[MEMBER + 1, MEMBER + 2].map((memberId) => ({
          memberId,
          pool: 'FF',
          rscSeniority: memberId,
          rankSeniority: memberId,
          exclusionReason: null,
          authoritativeAssignmentId: null,
          rank: 'FF',
          isProbationary: false,
          credentialNames: ['IAAI'],
          specialtyQualifications: [],
        })),
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
      .run(SESSION, NOW, isMock ? 1 : 0, JSON.stringify(snapshot.settings));
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
      bidOrder: [{ ordinal: 1, memberId: MEMBER, pool: 'FF', stageId: 'synthetic-ff' }],
    };
  });

  afterEach(async () => {
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

  function expectNoAwardEvidence() {
    for (const table of [
      'canonical_bid_session_state',
      'bid_command_events',
      'bid_audit_outbox',
      'bids',
    ]) {
      expect(
        h.sqlite
          .prepare(`SELECT count(*) AS count FROM ${table} WHERE bid_session_id=?`)
          .get(SESSION),
      ).toEqual({ count: 0 });
    }
    expect(
      h.sqlite
        .prepare(
          "SELECT count(*) AS count FROM bid_command_receipts WHERE bid_session_id=? AND outcome='accepted'",
        )
        .get(SESSION),
    ).toEqual({ count: 0 });
  }

  let commandCounter = 0;
  function common() {
    return {
      v: 1 as const,
      commandId: `b8619c19-0b60-4dcc-aa6b-${String(++commandCounter).padStart(12, '0')}`,
      bidSessionId: SESSION,
      expectedSeq: state.lastSeq,
      actor: { id: MEMBER, role: 'admin' as const },
      reason: 'Synthetic specialty priority regression',
      evidenceReference: 'Synthetic explicit response',
    };
  }
  async function apply(command: LiveBidCommand) {
    const result = await commit(command);
    if (result.canonicalState) state = result.canonicalState;
    return result;
  }
  async function start() {
    return apply({
      ...common(),
      type: 'live.start_specialty_adjudication',
      specialtyId: 'synthetic-specialty',
      positionId: SEAT,
      candidateMemberIds: [MEMBER + 1, MEMBER + 2],
    });
  }
  it.each(['live.record_selection', 'live.force_selection'] as const)(
    '%s cannot bypass higher qualification with three secondary credits',
    async (type) => {
      const before = structuredClone(state);
      const result = await apply({ ...common(), type, memberId: MEMBER, positionId: SEAT });
      expect(result.result).toMatchObject({
        kind: 'rejected',
        code: 'SPECIALTY_HIGHER_PRIORITY_UNRESOLVED',
      });
      expect(state).toEqual(before);
      expectNoAwardEvidence();
    },
  );
  it('rejects a forged or truncated interruption list at the canonical boundary', async () => {
    const result = await apply({
      ...common(),
      type: 'live.start_specialty_adjudication',
      specialtyId: 'synthetic-specialty',
      positionId: SEAT,
      candidateMemberIds: [MEMBER + 2],
    });
    expect(result.result).toMatchObject({
      kind: 'rejected',
      code: 'SPECIALTY_CANDIDATE_ORDER_INVALID',
    });
    expectNoAwardEvidence();
  });
  it('records durable seat/requester-specific declines, permits the waiting requester, and replays without duplicate awards', async () => {
    expect((await start()).result.kind).toBe('accepted');
    for (const memberId of [MEMBER + 1, MEMBER + 2]) {
      expect(
        (
          await apply({
            ...common(),
            type: 'live.resolve_specialty_candidate',
            memberId,
            outcome: 'DECLINE',
          })
        ).result.kind,
      ).toBe('accepted');
    }
    expect(state.live?.specialty).toBeNull();
    expect(state.live?.specialtyResponses).toHaveLength(2);
    expect(state.live?.specialtyResponses?.[0]).toMatchObject({
      positionId: SEAT,
      requesterMemberId: MEMBER,
      memberId: MEMBER + 1,
      outcome: 'DECLINE',
      evidenceReference: 'Synthetic explicit response',
    });
    const command: LiveBidCommand = {
      ...common(),
      type: 'live.record_selection',
      memberId: MEMBER,
      positionId: SEAT,
    };
    const result = await apply(command);
    expect(result.result.kind).toBe('accepted');
    const bytes = h.sqlite.serialize();
    expect((await apply(command)).result).toEqual(result.result);
    const replayBytes = h.sqlite.serialize();
    expect(replayBytes.length).toBe(bytes.length);
    expect(replayBytes.every((byte, index) => byte === bytes[index])).toBe(true);
    expect(state.fills[SEAT]?.memberId).toBe(MEMBER);
    expect(h.sqlite.prepare('SELECT count(*) AS count FROM bids').get()).toEqual({ count: 0 });
  });
  it('permits the next higher candidate to accept after the first declines', async () => {
    expect((await start()).result.kind).toBe('accepted');
    expect(
      (
        await apply({
          ...common(),
          type: 'live.resolve_specialty_candidate',
          memberId: MEMBER + 1,
          outcome: 'DECLINE',
        })
      ).result.kind,
    ).toBe('accepted');
    expect(
      (
        await apply({
          ...common(),
          type: 'live.resolve_specialty_candidate',
          memberId: MEMBER + 2,
          outcome: 'ACCEPT',
        })
      ).result.kind,
    ).toBe('accepted');
    expect(state.fills[SEAT]?.memberId).toBe(MEMBER + 2);
    expect(state.currentBidderId).toBe(MEMBER);
  });
  it('does not count an unrelated requester response as a waiver', async () => {
    state.live = {
      currentStageId: 'synthetic-ff',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: [],
      specialtyResponses: [MEMBER + 1, MEMBER + 2].map((memberId) => ({
        specialtyId: 'synthetic-specialty',
        positionId: SEAT,
        requesterMemberId: MEMBER + 99,
        memberId,
        outcome: 'DECLINE' as const,
        reason: 'Another request',
        evidenceReference: 'Another request',
      })),
    };
    expect(
      (
        await apply({
          ...common(),
          type: 'live.record_selection',
          memberId: MEMBER,
          positionId: SEAT,
        })
      ).result,
    ).toMatchObject({ kind: 'rejected', code: 'SPECIALTY_HIGHER_PRIORITY_UNRESOLVED' });
    expectNoAwardEvidence();
  });
  it('excludes candidates already awarded elsewhere without reopening or moving their seats', async () => {
    state.fills[PRIOR_SEAT] = { memberId: MEMBER + 1, ordinal: 2, bidId: 'synthetic-first-award' };
    state.fills[POOL_FIRST] = { memberId: MEMBER + 2, ordinal: 3, bidId: 'synthetic-second-award' };
    expect(
      (
        await apply({
          ...common(),
          type: 'live.record_selection',
          memberId: MEMBER,
          positionId: SEAT,
        })
      ).result.kind,
    ).toBe('accepted');
    expect(Object.keys(state.fills)).toHaveLength(3);
    expect(state.fills[PRIOR_SEAT]?.memberId).toBe(MEMBER + 1);
  });
  it('cannot amend an existing award into a specialty while higher candidates remain unresolved', async () => {
    state.fills[PRIOR_SEAT] = { memberId: MEMBER, ordinal: 1, bidId: 'synthetic-prior-award' };
    state.live = {
      currentStageId: 'synthetic-ff',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: 'synthetic-prior-award',
      dispositions: [],
    };
    expect(
      (
        await apply({
          ...common(),
          type: 'live.amend_selection',
          memberId: MEMBER,
          fromPositionId: PRIOR_SEAT,
          toPositionId: SEAT,
        })
      ).result,
    ).toMatchObject({ kind: 'rejected', code: 'SPECIALTY_HIGHER_PRIORITY_UNRESOLVED' });
    expectNoAwardEvidence();
    expect(state.fills[PRIOR_SEAT]?.bidId).toBe('synthetic-prior-award');
  });
});
