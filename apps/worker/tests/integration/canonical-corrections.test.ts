import { createHash } from 'node:crypto';
import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  type LiveBidCommand,
  LiveBidCommandSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitLiveBidCommand,
  loadCanonicalBidSessionState,
} from '../../src/commands/canonical-command-service.js';
import { getDb } from '../../src/db/index.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { mintPrintToken } from '../../src/exports/print-token.js';
import { app } from '../../src/index.js';
import { projectCanonicalMockCompletion } from '../../src/lib/annual-completion-result.js';
import { bidDefinitionContextHash } from '../../src/lib/bid-definition-context.js';
import type { PinnedBidSessionPolicySnapshot } from '../../src/lib/bid-definition-pin.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import { loadBidSessionPolicySnapshot } from '../../src/lib/bid-policy.js';
import { signJwt } from '../../src/lib/jwt.js';
import { loadCanonicalAmendmentLinks } from '../../src/lib/official-annual-completion.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

// Isolated synthetic frozen source and real canonical D1 receipt/audit adapter.
const SESSION = 'synthetic-correction-session';
const NOW = Date.parse('2027-01-01T10:00:00.000Z');
const CPT_A = 10001;
const CPT_B = 10002;
const LT_A = 10003;
const LT_B = 10004;
const SEATS = [
  ['synthetic-c1', 'CPT'],
  ['synthetic-c2', 'CPT'],
  ['synthetic-c3', 'CPT'],
  ['synthetic-specialty', 'CPT'],
  ['synthetic-l1', 'LT'],
  ['synthetic-l2', 'LT'],
] as const;
const RETAINS = new Set(['UNREACHABLE', 'DEFER']);
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function syntheticPolicy(deferred = false, capacity = false) {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-correction-policy',
    stages: [
      {
        id: 'captains',
        label: 'Captains',
        order: 0,
        memberIds: [CPT_A, CPT_B],
        opportunityPositionIds: [
          'synthetic-c1',
          'synthetic-c2',
          'synthetic-c3',
          'synthetic-specialty',
        ],
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
      specialties: [
        {
          id: 'synthetic-specialty',
          label: 'Synthetic specialty',
          mode: 'INTERRUPTING',
          opportunityPositionIds: ['synthetic-specialty'],
          requiredCredentialNames: [],
          requiredSpecialtyCodes: [],
          points: [],
          tieBreakChain: ['POINTS', 'RSC_SENIORITY'],
          ...(deferred
            ? {
                scoring: {
                  v: 1,
                  total: [],
                  so: [],
                  mo: [],
                  orderedPreference: {
                    mode: 'ORDERED_QUALIFICATIONS',
                    sourceRef: 'Synthetic specialty preference',
                    criteria: [{ credential: 'IAAI', alternatives: [], requiresAll: [] }],
                  },
                },
                rankingChannel: 'total',
              }
            : {}),
        },
      ],
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
          constraints: capacity
            ? [
                {
                  id: 'synthetic-scope',
                  label: 'Synthetic scoped limit',
                  sourceRef: 'synthetic:scope',
                  maximum: 1,
                  positionIds: [
                    'synthetic-c1',
                    'synthetic-c2',
                    'synthetic-c3',
                    'synthetic-specialty',
                  ],
                  memberIds: [],
                  ranks: [],
                  shifts: ['A'],
                },
              ]
            : [],
          ...(deferred
            ? {
                timingExceptions: [
                  {
                    id: 'synthetic-early',
                    label: 'Deferred specialty A-Day',
                    timing: 'AFTER_POSITION_SELECTION',
                    sourceRef: 'synthetic:early',
                    positionIds: ['synthetic-specialty'],
                    profileIds: [],
                  },
                ],
              }
            : {}),
        },
      },
    },
  });
}

describe('canonical audited corrections', () => {
  let h: TestD1;
  let snapshot: PinnedBidSessionPolicySnapshot;
  let policy: FrozenLiveBidPolicy;
  let state: BidSessionState;
  let nextId: number;
  let commandCounter: number;

  beforeEach(async ({ task }) => {
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
      livePolicy: syntheticPolicy(task.name.includes('deferred'), task.name.includes('capacity')),
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
      key: 'synthetic-correction-adoption',
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
        credentialNames: task.name.includes('deferred') && memberId === CPT_B ? ['IAAI'] : [],
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
      reason: 'Synthetic audited correction regression',
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
      newId: () => `synthetic-correction-${++nextId}`,
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

  function originalCommandFor(bidId: string) {
    const row = h.sqlite
      .prepare(
        "SELECT command_id FROM bid_command_events WHERE bid_session_id=? AND json_extract(event_json,'$.bidId')=? ORDER BY seq DESC LIMIT 1",
      )
      .get(SESSION, bidId) as { command_id: string } | undefined;
    if (!row) throw new Error('Synthetic source award receipt missing');
    return row.command_id;
  }

  function correct(
    positionId: string,
    replacement: { positionId: string; aDay: string | null } | null,
    overrides: Record<string, unknown> = {},
  ) {
    const fill = state.fills[positionId];
    if (!fill) throw new Error('Synthetic source award missing');
    return {
      ...common(),
      type: 'live.correct_bid',
      memberId: fill.memberId,
      originalCommandId: originalCommandFor(fill.bidId),
      originalBidId: fill.bidId,
      originalPositionId: positionId,
      originalADayCommandId: null,
      operation: replacement === null ? 'REVOKE' : 'REPLACE',
      replacement,
      ...overrides,
    } as unknown as LiveBidCommand;
  }

  it('corrects same-position A-Day on a previous non-last award with replay, restart and immutable audit lineage', async () => {
    await accepted(select(CPT_A, 'synthetic-c1', 'G1'));
    await accepted(select(CPT_B, 'synthetic-c2', 'G2'));
    const original = state.fills['synthetic-c1']!;
    const oldEvents = h.sqlite.prepare('SELECT * FROM bid_command_events ORDER BY seq').all();
    const command = correct('synthetic-c1', { positionId: 'synthetic-c1', aDay: 'G3' });
    expect(LiveBidCommandSchema.safeParse(command).success).toBe(true);
    const result = await apply(command);
    expect(result.result.kind).toBe('accepted');
    expect(state.fills['synthetic-c1']).toMatchObject({ memberId: CPT_A, aDay: 'G3' });
    expect(state).toMatchObject({ currentBidderId: LT_A, queueCursor: 2 });
    expect(h.sqlite.prepare('SELECT * FROM bid_command_events ORDER BY seq LIMIT 2').all()).toEqual(
      oldEvents,
    );
    expect(await loadCanonicalBidSessionState(h.env.DB, SESSION)).toEqual(state);
    expect((await apply(command)).result).toEqual(result.result);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_command_events').get()).toEqual({
      n: 3,
    });
    expect(await loadCanonicalAmendmentLinks(h.env.DB, SESSION)).toEqual([
      { original_bid_id: original.bidId, replacement_bid_id: state.fills['synthetic-c1']!.bidId },
    ]);
    expect(await loadBidSessionPolicySnapshot(getDb(h.env.DB), SESSION)).toEqual({
      snapshot,
      error: null,
    });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bids').get()).toEqual({ n: 0 });
  });

  it('rejects stale sequence, source mismatch, wrong session receipt and superseded lineage', async () => {
    await accepted(select(CPT_A, 'synthetic-c1', 'G1'));
    const command = correct('synthetic-c1', { positionId: 'synthetic-c3', aDay: 'G2' });
    expect((await apply({ ...command, expectedSeq: 0 })).result).toMatchObject({
      kind: 'rejected',
      code: 'STALE_SEQUENCE',
    });
    expect(
      (
        await apply({
          ...command,
          ...common(),
          originalCommandId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        } as LiveBidCommand)
      ).result,
    ).toMatchObject({ kind: 'rejected', code: 'CORRECTION_SOURCE_RECEIPT_INVALID' });
    const other = await apply({
      ...command,
      ...common(),
      originalBidId: 'wrong-source',
    } as LiveBidCommand);
    expect(other.result).toMatchObject({ kind: 'rejected', code: 'CORRECTION_SOURCE_NOT_ACTIVE' });
    await accepted(apply({ ...command, ...common() }));
    expect((await apply({ ...command, ...common() })).result).toMatchObject({
      kind: 'rejected',
      code: 'CORRECTION_SOURCE_NOT_ACTIVE',
    });
  });

  it('returns position and A-Day capacity on revocation then restores a legal replacement from its receipt', async () => {
    await accepted(select(CPT_A, 'synthetic-c1', 'G1'));
    await accepted(select(CPT_B, 'synthetic-c2', 'G2'));
    const revoked = await apply(correct('synthetic-c1', null));
    expect(revoked.result.kind).toBe('accepted');
    if (revoked.result.kind !== 'accepted') return;
    expect(state.fills['synthetic-c1']).toBeUndefined();
    expect(state.aDay?.picks.some((pick) => pick.memberId === CPT_A)).toBe(false);
    await accepted(select(LT_A, 'synthetic-l1', 'G1'));
    await accepted(select(LT_B, 'synthetic-l2', 'G2'));
    expect((await apply({ ...common(), type: 'live.complete_session' })).result).toMatchObject({
      kind: 'rejected',
      code: 'UNRESOLVED_CORRECTIONS_BLOCK_COMPLETION',
    });
    state = (await loadCanonicalBidSessionState(h.env.DB, SESSION))!;
    await accepted(
      apply({
        ...common(),
        type: 'live.correct_bid',
        memberId: CPT_A,
        originalCommandId: revoked.result.commandId,
        originalBidId: (revoked.result.envelope.payload as { bidId: string }).bidId,
        originalPositionId: 'synthetic-c1',
        originalADayCommandId: null,
        operation: 'REPLACE',
        replacement: { positionId: 'synthetic-c3', aDay: 'G3' },
      } as unknown as LiveBidCommand),
    );
    expect(state.fills['synthetic-c3']).toMatchObject({ memberId: CPT_A, ordinal: 1, aDay: 'G3' });
    await accepted(apply({ ...common(), type: 'live.complete_session' }));
  });

  it('corrects a specialty award and reruns priority against only affected released capacity', async () => {
    await accepted(select(CPT_A, 'synthetic-specialty', 'G1'));
    await accepted(select(CPT_B, 'synthetic-c2', 'G2'));
    await accepted(
      apply(correct('synthetic-specialty', { positionId: 'synthetic-specialty', aDay: 'G3' })),
    );
    expect(state.aDay?.picks.find((pick) => pick.memberId === CPT_A)?.aDay).toBe('G3');
  });

  it('rejects a specialty move while a higher priority qualified member remains unresolved', async () => {
    await accepted(apply({ ...common(), type: 'live.disposition', disposition: 'PASS' }));
    await accepted(select(CPT_B, 'synthetic-c2', 'G2'));
    const before = state;
    expect(
      (await apply(correct('synthetic-c2', { positionId: 'synthetic-specialty', aDay: 'G3' })))
        .result,
    ).toMatchObject({ kind: 'rejected', code: 'SPECIALTY_HIGHER_PRIORITY_UNRESOLVED' });
    expect(state).toEqual(before);
  });

  it('rejects frozen eligibility and scoped A-Day capacity violations without partial changes', async () => {
    await accepted(select(CPT_A, 'synthetic-c1', 'G1'));
    await accepted(select(CPT_B, 'synthetic-c2', 'G2'));
    const before = state;
    expect(
      (await apply(correct('synthetic-c1', { positionId: 'synthetic-l1', aDay: 'G3' }))).result
        .kind,
    ).toBe('rejected');
    expect(
      (await apply(correct('synthetic-c1', { positionId: 'synthetic-c3', aDay: 'G2' }))).result,
    ).toMatchObject({ kind: 'rejected', code: 'SCOPED_A_DAY_MAXIMUM' });
    expect(state).toEqual(before);
    expect(await loadCanonicalBidSessionState(h.env.DB, SESSION)).toEqual(before);
  });

  it('corrects a deferred A-Day only with the active award and original A-Day receipt', async () => {
    await accepted(
      apply({
        ...common(),
        type: 'live.start_specialty_adjudication',
        specialtyId: 'synthetic-specialty',
        positionId: 'synthetic-specialty',
        candidateMemberIds: [CPT_B],
      }),
    );
    await accepted(
      apply({
        ...common(),
        type: 'live.resolve_specialty_candidate',
        memberId: CPT_B,
        outcome: 'ACCEPT',
      }),
    );
    await accepted(select(CPT_A, 'synthetic-c1', 'G1'));
    const aDayCommand = {
      ...common(),
      type: 'live.record_a_day',
      memberId: CPT_B,
      aDay: 'G2',
    } as LiveBidCommand;
    await accepted(apply(aDayCommand));
    expect(
      (
        await apply(
          correct('synthetic-specialty', { positionId: 'synthetic-specialty', aDay: 'G3' }),
        )
      ).result,
    ).toMatchObject({ kind: 'rejected', code: 'CORRECTION_A_DAY_RECEIPT_REQUIRED' });
    await accepted(
      apply(
        correct(
          'synthetic-specialty',
          { positionId: 'synthetic-specialty', aDay: 'G3' },
          { originalADayCommandId: aDayCommand.commandId },
        ),
      ),
    );
    expect(state.aDay?.picks.find((pick) => pick.memberId === CPT_B)?.aDay).toBe('G3');
    expect(state).toMatchObject({ currentBidderId: LT_A, queueCursor: 2 });
  });

  it('previews with the same validators without creating receipts, events, audit or state changes', async () => {
    await accepted(select(CPT_A, 'synthetic-c1', 'G1'));
    const before = state;
    const count = h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_command_receipts').get();
    const command = correct('synthetic-c1', { positionId: 'synthetic-c3', aDay: 'G2' });
    const preview = await commitLiveBidCommand({
      db: h.env.DB,
      command,
      state,
      policy,
      previewOnly: true,
    } as Parameters<typeof commitLiveBidCommand>[0]);
    expect(preview.result.kind).toBe('accepted');
    expect(preview.canonicalState?.fills['synthetic-c3']).toMatchObject({
      memberId: CPT_A,
      aDay: 'G2',
    });
    expect(await loadCanonicalBidSessionState(h.env.DB, SESSION)).toEqual(before);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_command_receipts').get()).toEqual(count);
    await accepted(apply(command));
    expect(state.fills['synthetic-c3']?.aDay).toBe('G2');
  });

  it('reconciles canonical Results, roster export and final lineage after correction', async () => {
    await accepted(select(CPT_A, 'synthetic-c1', 'G1'));
    await accepted(select(CPT_B, 'synthetic-c2', 'G2'));
    await accepted(apply(correct('synthetic-c1', { positionId: 'synthetic-c3', aDay: 'G3' })));
    await accepted(select(LT_A, 'synthetic-l1', 'G1'));
    await accepted(select(LT_B, 'synthetic-l2', 'G2'));
    await accepted(apply({ ...common(), type: 'live.complete_session' }));
    const token = await signJwt(
      {
        sub: 0,
        emp: 'synthetic-cpt-a',
        rank: 'CPT',
        first_name: 'Synthetic',
        last_name: 'Admin',
        role: 'admin',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
    const results = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${SESSION}/results`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      h.env,
    );
    expect(results.status).toBe(200);
    const body = (await results.json()) as {
      rows: Array<{ position_id: string; member_id: number; a_day: string }>;
    };
    expect(JSON.stringify(body)).toContain('synthetic-c3');
    expect(JSON.stringify(body)).toContain('G3');
    const printToken = mintPrintToken(
      { kind: 'roster', shift: 'A', session_id: SESSION },
      h.env.JWT_SIGNING_KEY,
    );
    const roster = await app.fetch(
      new Request(
        `http://x/api/admin/exports/roster-data?session_id=${SESSION}&shift=A&token=${printToken}`,
      ),
      h.env,
    );
    expect(roster.status).toBe(200);
    const exported = (await roster.json()) as {
      awards?: unknown;
      stations: Array<{ rows: Array<{ position_id: string; member_id: string | null }> }>;
    };
    const rows = exported.stations.flatMap((station) => station.rows);
    expect(rows.find((row) => row.position_id === 'synthetic-c1')?.member_id).toBeNull();
    expect(rows.find((row) => row.position_id === 'synthetic-c3')?.member_id).toBeTruthy();
  });
});
