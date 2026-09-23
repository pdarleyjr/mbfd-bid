import { deepStrictEqual } from 'node:assert';
import {
  type BidDefinitionContent,
  BidDispositionSchema,
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { app } from '../../src/index.js';
import { prepareBidDefinitionRun } from '../../src/lib/bid-definition-run.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import {
  loadFrozenSessionBidPolicy,
  prepareBidSessionPolicySnapshot,
} from '../../src/lib/bid-policy.js';
import { signJwt } from '../../src/lib/jwt.js';
import { computeFrozenStageOrder } from '../../src/lib/live-bid-policy.js';
import { evaluateLiveBidReadiness } from '../../src/lib/live-bid-readiness.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

type Version = Extract<Awaited<ReturnType<typeof loadBidDefinitionVersion>>, { ok: true }>;
const SEAT = 'synthetic-configured-stage-seat';
const RESERVED = 'synthetic-configured-stage-reserved';
const ORIGINAL_ORDER = [
  { ordinal: 1, memberId: 10002, stageId: 'EARLIER' },
  { ordinal: 2, memberId: 10003, stageId: 'EARLIER' },
  { ordinal: 3, memberId: 10001, stageId: 'LATER' },
];

function stageById(execution: FrozenLiveBidPolicy, id: string) {
  const stage = execution.stages.find((entry) => entry.id === id);
  if (!stage) throw new Error(`Synthetic stage ${id} required`);
  return stage;
}

function annualPolicy(execution: FrozenLiveBidPolicy) {
  if (!execution.annualOperations) throw new Error('Synthetic annual operations required');
  return execution.annualOperations;
}

function policy(): FrozenLiveBidPolicy {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-administrative-stage-practice',
    // Array order deliberately differs from execution order. RSC and rank
    // seniority within EARLIER must both precede the later configured stage.
    stages: [
      {
        id: 'LATER',
        label: 'Later stage',
        order: 30,
        memberIds: [10001],
        opportunityPositionIds: [SEAT],
        kind: 'FIREFIGHTER',
      },
      {
        id: 'EARLIER',
        label: 'Earlier stage',
        order: 10,
        memberIds: [10003, 10002],
        opportunityPositionIds: [SEAT],
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
      actorMemberIds: [10001],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
    annualOperations: {
      v: 1,
      stageOrder: ['EARLIER', 'LATER'],
      requiredTopologyPositionIds: [SEAT],
      contact: { minimumAttempts: 1, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 0,
        max: 4,
        captainDcMax: 2,
        specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
      },
    },
  });
}

describe.each([2026, 2027])('configured annual stages in %s', (year) => {
  let h: TestD1;
  let token: string;
  let content: BidDefinitionContent;
  let sourceToken: string;
  let counter: number;

  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    counter = 0;
    h.sqlite.exec(`
      INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,rank_seniority,is_probationary,employment_status,employment_status_effective_on,created_at,updated_at)
      VALUES (10001,'synthetic-stage-10001','Synthetic','Editor','FF','FF',1,1,0,'active','2020-01-01',1,1),
        (10002,'synthetic-stage-10002','Synthetic','Second','FF','FF',10,2,0,'active','2020-01-01',1,1),
        (10003,'synthetic-stage-10003','Synthetic','Third','FF','FF',10,3,0,'active','2020-01-01',1,1),
        (10004,'synthetic-stage-10004','Synthetic','Excluded','FF','FF',4,4,0,'unknown',NULL,1,1);
      INSERT INTO position_templates(version,effective_year) VALUES ('${year}.1',${year});
      INSERT INTO rule_books(version,effective_year,status,revision) VALUES ('${year}.1',${year},'draft',0);
      INSERT INTO bid_years(year,status,rule_book_version,position_template_version,configuration_revision,config_json)
      VALUES (${year},'configuring','${year}.1','${year}.1',1,
        '{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"${year}-01-01","personnelEvaluationOn":"${year}-01-01"}');
      INSERT INTO positions(id,template_version,shift,station,division,unit,rank_required,position_name)
      VALUES ('${SEAT}','${year}.1','A','7','Combat','Synthetic Engine','FF','Synthetic firefighter'),
        ('${RESERVED}','${year}.1','D','7','Administration','Synthetic Office','FF','Synthetic reserved position');
      INSERT INTO position_rules(rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
      VALUES ('${year}.1','${SEAT}','${year}.1','{"rank":["FF"],"credentials":[],"custom":[]}',
        '{"max":0,"items":[]}','["rsc_seniority"]');
      INSERT INTO rule_book_position_participation(rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
      VALUES ('${year}.1','${RESERVED}','${year}.1','RESERVED_NON_BIDDABLE','Synthetic reserved source',1);
    `);
    const source = await captureBidDefinitionSource(h.env.DB, year);
    if (!source.ok) throw new Error(JSON.stringify(source));
    content = structuredClone(source.content);
    sourceToken = source.sourceToken;
    const execution = policy();
    content.settings = {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: `${year}-01-01`,
      personnelEvaluationOn: `${year}-01-01`,
      livePolicy: execution,
    };
    content.policy = {
      policyText: 'Synthetic configurable stages exercise; no historical-policy approval.',
      executionPolicy: execution,
    };
    token = await signJwt(
      {
        sub: 10001,
        emp: 'synthetic-stage-10001',
        role: 'admin',
        rank: 'FF',
        first_name: 'Synthetic',
        last_name: 'Editor',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  function save(candidate = content, previous?: Version) {
    return saveBidDefinition(h.env.DB, {
      year,
      key: `synthetic-stage-save-${++counter}`,
      actorSubject: '10001',
      actorId: 10001,
      expected: previous
        ? {
            kind: 'version',
            versionId: previous.row.id,
            revision: previous.row.version_number,
            sha256: previous.sha256,
          }
        : { kind: 'legacy', sourceToken },
      reason: 'Synthetic stage editing exercise',
      intent: { operation: 'save', content: candidate },
    });
  }
  async function saved(candidate = content, previous?: Version) {
    const result = await save(candidate, previous);
    if (!result.ok) throw new Error(JSON.stringify(result));
    const version = await loadBidDefinitionVersion(
      h.env.DB,
      year,
      String(result.response.versionId),
    );
    if (!version.ok) throw new Error(JSON.stringify(version));
    return version;
  }
  async function readOnly<T>(operation: () => Promise<T>) {
    const before = h.sqlite.serialize();
    const value = await operation();
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    return value;
  }
  function prepare(version: Version, mode: 'mock' | 'live' = 'mock') {
    return readOnly(() =>
      prepareBidDefinitionRun(h.env.DB, {
        year,
        versionId: version.row.id,
        versionSha256: version.sha256,
        mode,
        bidSessionId: 'synthetic-stage-preview',
        capturedAtMs: Date.parse(`${year}-02-01T12:00:00Z`),
      }),
    );
  }
  async function post(path: string, body: unknown) {
    return app.fetch(
      new Request(`http://x/api/admin/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `synthetic-stage-request-${++counter}`,
        },
        body: JSON.stringify(body),
      }),
      h.env,
    );
  }
  async function createMock(version: Version) {
    const selection = { versionId: version.row.id, versionSha256: version.sha256 };
    const preview = await post(`bid/${year}/preview`, { kind: 'mock', ...selection });
    expect(preview.status, await preview.clone().text()).toBe(200);
    const reviewed = (await preview.json()) as {
      contextSha256: string;
      runtimeSourceToken: string;
    };
    const created = await post(`bid/${year}/mock-sessions`, {
      ...selection,
      expectedContextSha256: reviewed.contextSha256,
      expectedSourceToken: reviewed.runtimeSourceToken,
    });
    expect(created.status, await created.clone().text()).toBe(201);
    return (await created.json()) as { id: string };
  }
  function configureUnresolvedTypedParticipantSources(candidate: BidDefinitionContent) {
    if (!candidate.policy) throw new Error('V3 policy fixture required');
    const comparator = [{ key: 'RSC_SENIORITY' as const, direction: 'ASC' as const }];
    candidate.policy.stageParticipantSources = [
      {
        stageId: 'EARLIER',
        sourceRef: 'Synthetic Earlier-stage roster',
        participantSource: {
          type: 'FILTER',
          active: true,
          bidParticipation: 'BIDDABLE',
          ranks: ['FF'],
          includeMemberIds: [10003],
          excludeMemberIds: [10001],
        },
        ordering: comparator,
      },
      {
        stageId: 'LATER',
        sourceRef: 'Synthetic Later-stage roster',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [10001] },
        ordering: comparator,
      },
    ];
    candidate.policy.orderingAuthority = {
      v: 1,
      sourceDecisionId: 'synthetic-open-governing-ordering-decision',
      comparator,
    };
    candidate.sourceDecisions = [
      {
        issueId: 'synthetic-open-governing-ordering-decision',
        title: 'Synthetic annual ordering authority',
        question: 'Which reviewed comparator governs the synthetic annual Bid order?',
        area: 'annual-policy',
        status: 'OPEN',
        decision: '',
        sourceRef: 'Synthetic annual-policy source evidence.',
        effectiveOn: `${year}-01-01`,
      },
    ];
    return candidate;
  }

  async function seedAcceptedParticipantPreviewBaseline(): Promise<void> {
    const importId = `synthetic-stage-baseline-${year}`;
    const staffingId = `synthetic-stage-staffing-${year}`;
    const mappingId = `synthetic-stage-mapping-${year}`;
    const rowId = `synthetic-stage-row-${year}`;
    h.sqlite.exec(
      `INSERT INTO staffing_positions
         (id, stable_slot_key, shift, station, unit, position_name, applicable_rank,
          active_from, review_status, created_at, updated_at)
       VALUES ('${staffingId}', 'SYNTHETIC/${year}/A/7/FF', 'A', '7', 'Synthetic Engine',
         'Synthetic firefighter', 'FF', '${year}-01-01', 'approved', 1, 1);
       INSERT INTO staffing_position_source_mappings
         (id, staffing_position_id, source_system, source_locator, source_signature,
          source_version, source_hash, effective_from, created_at)
       VALUES ('${mappingId}', '${staffingId}', 'telestaff',
         '{"v":1,"shift":"A","division":"Combat","station":"7","unit":"Synthetic Engine","position":"Synthetic firefighter"}',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '${importId}',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '${year}-01-01', 1);
       INSERT INTO assignment_imports
         (id, source_system, source_version, source_hash, source_format, parser_version, source_kind,
          status, input_row_count, normalized_data_row_count, unique_employee_count,
          report_row_count, structural_row_count, source_snapshot_as_of, created_at)
       VALUES ('${importId}', 'telestaff', '${importId}',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'TELSTAFF_ASSIGNMENTS_HTML_V1', 'telestaff-assignments-html@1',
         'official', 'staged', 1, 1, 1, 1, 0, '${year}-01-01', 1);
       INSERT INTO assignment_import_rows
         (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
          resolved_member_id, normalized_source_topology, source_topology_completeness,
          disposition, reconciliation_classification, review_status, resolution_action,
          reviewed_at, reviewed_by_member_id, resolution_reason, created_at)
       VALUES ('${rowId}', '${importId}', 1,
         'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
         'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 10004,
         '{"v":1,"shift":"A","division":"Combat","station":"7","unit":"Synthetic Engine","position":"Synthetic firefighter"}',
         'complete', 'ambiguous_mapping', 'AMBIGUOUS_MAPPING', 'rejected', 'REJECT_SOURCE_ROW',
         1, 10001, 'Synthetic repeated-seat ambiguity with resolved member presence.', 1);`,
    );
    await h.db.run('UPDATE assignment_imports SET status = ? WHERE id = ?', ['reviewed', importId]);
    await h.db.run(
      'UPDATE assignment_imports SET status = ?, approved_at = 1, approved_by_member_id = 10001 WHERE id = ?',
      ['approved', importId],
    );
    await h.db.run('UPDATE assignment_imports SET status = ?, committed_at = 1 WHERE id = ?', [
      'committed',
      importId,
    ]);
    h.sqlite.exec(
      `INSERT INTO bid_year_staffing_baselines
         (id, bid_year, assignment_import_id, status, accepted_at, accepted_by_member_id,
          acceptance_reason, created_at)
       VALUES ('synthetic-stage-baseline-acceptance-${year}', ${year}, '${importId}', 'accepted',
         1, 10001, 'Synthetic accepted baseline for participant-preview coverage.', 1);`,
    );
  }

  it('reads an existing unsorted policy array by configured order without rewriting its snapshot', async () => {
    const db = getDb(h.env.DB);
    const capturedAtMs = Date.parse(`${year}-02-01T12:00:00Z`);
    h.sqlite
      .prepare('UPDATE bid_years SET config_json=? WHERE year=?')
      .run(JSON.stringify(content.settings), year);
    const prepared = await readOnly(() =>
      prepareBidSessionPolicySnapshot(db, year, capturedAtMs, 'mock'),
    );
    if (!prepared.ok || prepared.snapshot.settings.v !== 3)
      throw new Error(JSON.stringify(prepared));
    expect(prepared.snapshot.settings.livePolicy.stages.map((stage) => stage.id)).toEqual([
      'LATER',
      'EARLIER',
    ]);
    const sessionId = 'synthetic-stage-existing-snapshot';
    h.sqlite
      .prepare(`INSERT INTO bid_sessions(id,bid_year,started_at,current_phase,is_mock,turn_timer_seconds,expected_duration_days,config_json)
      VALUES (?,?,?,'config',1,180,2,?)`)
      .run(sessionId, year, capturedAtMs, JSON.stringify(content.settings));
    h.sqlite
      .prepare(`INSERT INTO bid_session_policy_snapshots(bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at)
      VALUES (?,?,?,?,?,?)`)
      .run(
        sessionId,
        prepared.snapshot.ruleBookVersion,
        prepared.snapshot.positionTemplateVersion,
        prepared.snapshot.ruleBookRevision,
        JSON.stringify(prepared.snapshot),
        capturedAtMs,
      );
    const frozen = await readOnly(() => loadFrozenSessionBidPolicy(db, sessionId));
    if (!frozen.ok) throw new Error(JSON.stringify(frozen));
    const readiness = await readOnly(() =>
      evaluateLiveBidReadiness({
        db,
        env: h.env,
        bidSessionId: sessionId,
        bidYear: year,
        frozenPolicy: frozen,
        operatorAuthorized: false,
      }),
    );
    expect(readiness.checks.find((entry) => entry.id === 'annual_operations_policy')?.status).toBe(
      'READY',
    );
    expect(readiness.checks.find((entry) => entry.id === 'ordering_authority')).toEqual({
      id: 'ordering_authority',
      status: 'BLOCKING',
      detail:
        'Bid ordering authority unresolved. Live operation is not authorized until the governing comparator is reconciled.',
    });
    expect(readiness.canStartLiveBid).toBe(false);
    expect(await readOnly(() => loadFrozenSessionBidPolicy(db, sessionId))).toEqual(frozen);
  });

  it('starts a saved custom Mock with frozen stage order after the current Bid changes', async () => {
    const version = await saved();
    const session = await createMock(version);
    const frozen = await readOnly(() => loadFrozenSessionBidPolicy(getDb(h.env.DB), session.id));
    if (!frozen.ok || frozen.snapshot.settings.v !== 3) throw new Error(JSON.stringify(frozen));
    expect(computeFrozenStageOrder(frozen.snapshot, frozen.snapshot.settings.livePolicy)).toEqual({
      ok: true,
      entries: ORIGINAL_ORDER,
    });
    // Actual Live readiness must sort the frozen stage.order, and must retain
    // independent publication, baseline and runtime authority failures.
    const readiness = await readOnly(() =>
      evaluateLiveBidReadiness({
        db: getDb(h.env.DB),
        env: h.env,
        bidSessionId: session.id,
        bidYear: year,
        frozenPolicy: frozen,
        operatorAuthorized: false,
      }),
    );
    expect(readiness.checks.find((entry) => entry.id === 'annual_operations_policy')?.status).toBe(
      'READY',
    );
    expect(readiness.canStartLiveBid).toBe(false);
    expect(readiness.checks.find((entry) => entry.id === 'operator_authorization')?.status).toBe(
      'BLOCKING',
    );
    expect(
      readiness.checks.find((entry) => entry.id === 'accepted_staffing_baseline')?.status,
    ).toBe('BLOCKING');

    const changed = structuredClone(version.content);
    if (changed.settings?.v !== 3 || !changed.policy) throw new Error('V3 fixture required');
    stageById(changed.settings.livePolicy, 'LATER').order = 0;
    annualPolicy(changed.settings.livePolicy).stageOrder = ['LATER', 'EARLIER'];
    changed.policy.executionPolicy = changed.settings.livePolicy;
    const successor = await saved(changed, version);
    const newer = await prepare(successor);
    if (!newer.ok || newer.snapshot.settings.v !== 3) throw new Error(JSON.stringify(newer));
    expect(computeFrozenStageOrder(newer.snapshot, newer.snapshot.settings.livePolicy)).toEqual({
      ok: true,
      entries: [
        { ordinal: 1, memberId: 10001, stageId: 'LATER' },
        { ordinal: 2, memberId: 10002, stageId: 'EARLIER' },
        { ordinal: 3, memberId: 10003, stageId: 'EARLIER' },
      ],
    });
    const started = await post(`bid-session/${session.id}/start`, {});
    expect(started.status, await started.clone().text()).toBe(200);
    expect(
      h.sqlite
        .prepare(
          'SELECT ordinal,member_id AS memberId,stage_id AS stageId FROM bid_order WHERE bid_session_id=? ORDER BY ordinal',
        )
        .all(session.id),
    ).toEqual(ORIGINAL_ORDER);
    const reloaded = await readOnly(() => loadFrozenSessionBidPolicy(getDb(h.env.DB), session.id));
    expect(reloaded).toEqual(frozen);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['add', 'remove'] as const)(
    'prepares explicit stage %s with complete redistributed participation',
    async (operation) => {
      if (content.settings?.v !== 3 || !content.policy) throw new Error('V3 fixture required');
      const execution = content.settings.livePolicy;
      if (operation === 'add') {
        stageById(execution, 'EARLIER').memberIds = [10002];
        execution.stages.push({
          id: 'MIDDLE',
          label: 'New stage',
          order: 20,
          memberIds: [10003],
          opportunityPositionIds: [SEAT],
          kind: 'FIREFIGHTER',
        });
        annualPolicy(execution).stageOrder = ['EARLIER', 'MIDDLE', 'LATER'];
      } else {
        execution.stages = [
          {
            id: 'ONE',
            label: 'Combined stage',
            order: 90,
            memberIds: [10003, 10002, 10001],
            opportunityPositionIds: [SEAT],
            kind: 'FIREFIGHTER',
          },
        ];
        annualPolicy(execution).stageOrder = ['ONE'];
      }
      content.policy.executionPolicy = execution;
      const result = await prepare(await saved());
      if (!result.ok || result.snapshot.settings.v !== 3) throw new Error(JSON.stringify(result));
      expect(computeFrozenStageOrder(result.snapshot, result.snapshot.settings.livePolicy)).toEqual(
        {
          ok: true,
          entries:
            operation === 'add'
              ? [
                  { ordinal: 1, memberId: 10002, stageId: 'EARLIER' },
                  { ordinal: 2, memberId: 10003, stageId: 'MIDDLE' },
                  { ordinal: 3, memberId: 10001, stageId: 'LATER' },
                ]
              : [
                  { ordinal: 1, memberId: 10001, stageId: 'ONE' },
                  { ordinal: 2, memberId: 10002, stageId: 'ONE' },
                  { ordinal: 3, memberId: 10003, stageId: 'ONE' },
                ],
        },
      );
    },
  );

  it('keeps typed participant membership out of Mock and Live preparation while ordering authority is unresolved', async () => {
    if (!content.policy) throw new Error('V3 policy fixture required');
    content.policy.stageParticipantSources = [
      {
        stageId: 'EARLIER',
        sourceRef: 'Synthetic Earlier-stage roster',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [10003, 10002] },
        ordering: [{ key: 'RANK_SENIORITY', direction: 'DESC' }],
      },
      {
        stageId: 'LATER',
        sourceRef: 'Synthetic Later-stage roster',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [10001] },
        ordering: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
      },
    ];
    const version = await saved();
    expect(await prepare(version)).toEqual({
      ok: false,
      code: 'stage_authoring_ordering_authority_unresolved',
    });
    const preview = await readOnly(() =>
      post(`bid/${year}/preview`, {
        kind: 'mock',
        versionId: version.row.id,
        versionSha256: version.sha256,
      }),
    );
    expect(preview.status, await preview.clone().text()).toBe(200);
    expect(await preview.json()).toEqual({
      wouldAllowCreateMock: false,
      policyError: 'stage_authoring_ordering_authority_unresolved',
    });
  });

  it('returns display-only typed participant membership from one zero-write captured preview', async () => {
    configureUnresolvedTypedParticipantSources(content);

    const before = h.sqlite.serialize();
    const sessionLookup = vi.spyOn(h.env.BID_SESSION, 'get');
    const response = await post(`bid/${year}/preview`, {
      kind: 'stage-participant-membership',
      expected: { kind: 'legacy', sourceToken },
      intent: { operation: 'save', content },
    });
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(sessionLookup).not.toHaveBeenCalled();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const result = (await response.json()) as {
      valid: boolean;
      definition: { kind: string; sourceToken?: string };
      source: { baselineContentSha256: string; candidateContentSha256: string };
      runtimeSourceToken: string;
      contextSha256: string;
      participantPreviewSha256: string;
      orderingAuthority: { status: string; code?: string };
      membership: { status: string };
      stages: Array<{
        stageId: string;
        matchedMemberIds: number[];
        displayOrder: string;
        matchedMembers: Array<{ memberId: number; displayName: string | null }>;
        exceptionMembers?: Array<{ memberId: number; displayName: string | null }>;
      }>;
      executionReady: boolean;
      executionIssues: string[];
    };
    expect(result.valid).toBe(true);
    expect(result.definition).toEqual({ kind: 'LEGACY_SOURCE', sourceToken });
    expect(result.source.baselineContentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.source.candidateContentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.runtimeSourceToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.contextSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.participantPreviewSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.membership).toEqual({ status: 'RESOLVED_FOR_PREVIEW' });
    expect(result.orderingAuthority).toMatchObject({
      status: 'UNRESOLVED',
      code: 'ordering_authority_source_decision_unresolved',
    });
    expect(result.stages).toMatchObject([
      {
        stageId: 'EARLIER',
        matchedMemberIds: [10002, 10003],
        displayOrder: 'MEMBER_ID_ASC',
        matchedMembers: [
          { memberId: 10002, displayName: 'Synthetic Second' },
          { memberId: 10003, displayName: 'Synthetic Third' },
        ],
        exceptionMembers: [
          { memberId: 10001, displayName: 'Synthetic Editor' },
          { memberId: 10003, displayName: 'Synthetic Third' },
        ],
      },
      {
        stageId: 'LATER',
        matchedMemberIds: [10001],
        displayOrder: 'MEMBER_ID_ASC',
        matchedMembers: [{ memberId: 10001, displayName: 'Synthetic Editor' }],
      },
    ]);
    expect(result.executionReady).toBe(false);
    expect(result.executionIssues).toEqual(['ordering_authority_source_decision_unresolved']);
    for (const table of [
      'bid_definition_versions',
      'bid_definition_heads',
      'bid_sessions',
      'bid_session_policy_snapshots',
      'canonical_bid_session_state',
      'bid_command_receipts',
      'bid_audit_outbox',
    ]) {
      expect(h.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
  });

  it('uses the accepted staffing baseline when previewing Mock stage membership', async () => {
    await seedAcceptedParticipantPreviewBaseline();
    const refreshedSource = await captureBidDefinitionSource(h.env.DB, year);
    if (!refreshedSource.ok) throw new Error(JSON.stringify(refreshedSource));
    sourceToken = refreshedSource.sourceToken;
    configureUnresolvedTypedParticipantSources(content);
    if (!content.policy || content.settings?.v !== 3) throw new Error('V3 policy fixture required');
    const earlierSource = content.policy.stageParticipantSources?.find(
      (source) => source.stageId === 'EARLIER',
    );
    if (!earlierSource) throw new Error('Synthetic Earlier-stage source required');
    earlierSource.participantSource = {
      type: 'EXPLICIT_MEMBERS',
      memberIds: [10002, 10003, 10004],
    };
    stageById(content.settings.livePolicy, 'EARLIER').memberIds.push(10004);
    content.policy.executionPolicy = content.settings.livePolicy;

    const before = h.sqlite.serialize();
    const response = await post(`bid/${year}/preview`, {
      kind: 'stage-participant-membership',
      expected: { kind: 'legacy', sourceToken },
      intent: { operation: 'save', content },
    });
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      valid: true,
      membership: { status: 'RESOLVED_FOR_PREVIEW' },
      stages: [
        { stageId: 'EARLIER', matchedMemberIds: [10002, 10003, 10004] },
        { stageId: 'LATER', matchedMemberIds: [10001] },
      ],
    });
  });

  it('keeps every unrelated OPEN source decision blocking during participant preview', async () => {
    configureUnresolvedTypedParticipantSources(content);
    content.sourceDecisions.push({
      issueId: 'synthetic-unrelated-open-decision',
      title: 'Synthetic unresolved staffing question',
      question: 'Which reviewed source settles the synthetic staffing question?',
      area: 'positions',
      status: 'OPEN',
      decision: '',
      sourceRef: 'Synthetic positions source evidence.',
      effectiveOn: `${year}-01-01`,
    });
    const before = h.sqlite.serialize();
    const sessionLookup = vi.spyOn(h.env.BID_SESSION, 'get');
    const response = await post(`bid/${year}/preview`, {
      kind: 'stage-participant-membership',
      expected: { kind: 'legacy', sourceToken },
      intent: { operation: 'save', content },
    });
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(sessionLookup).not.toHaveBeenCalled();
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: 'policy_source_decision_required' });
  });

  it('reports both blocked membership and unresolved authority without producing a partial candidate set', async () => {
    configureUnresolvedTypedParticipantSources(content);
    const earlier = content.policy?.stageParticipantSources?.find(
      (source) => source.stageId === 'EARLIER',
    );
    if (!earlier || earlier.participantSource.type !== 'FILTER')
      throw new Error('Synthetic Earlier-stage filter source required');
    earlier.participantSource.includeMemberIds = [10003, 10004];
    const before = h.sqlite.serialize();
    const response = await post(`bid/${year}/preview`, {
      kind: 'stage-participant-membership',
      expected: { kind: 'legacy', sourceToken },
      intent: { operation: 'save', content },
    });
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = (await response.json()) as {
      valid: boolean;
      membership: { status: string; code?: string; memberIds?: number[] };
      orderingAuthority: { status: string; code?: string };
      stages: unknown[];
      executionReady: boolean;
      executionIssues: string[];
    };
    expect(result.valid).toBe(true);
    expect(result.membership).toMatchObject({
      status: 'BLOCKED',
      code: 'stage_authoring_member_not_participant',
      memberIds: [10004],
    });
    expect(result.orderingAuthority).toMatchObject({
      status: 'UNRESOLVED',
      code: 'ordering_authority_source_decision_unresolved',
    });
    expect(result.stages).toEqual([]);
    expect(result.executionReady).toBe(false);
    expect(result.executionIssues).toEqual([
      'stage_authoring_member_not_participant',
      'ordering_authority_source_decision_unresolved',
    ]);
  });

  it('rejects a typed preview whose named ordering decision is missing before evaluation', async () => {
    configureUnresolvedTypedParticipantSources(content);
    content.sourceDecisions = [];
    const before = h.sqlite.serialize();
    const sessionLookup = vi.spyOn(h.env.BID_SESSION, 'get');
    const response = await post(`bid/${year}/preview`, {
      kind: 'stage-participant-membership',
      expected: { kind: 'legacy', sourceToken },
      intent: { operation: 'save', content },
    });
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(sessionLookup).not.toHaveBeenCalled();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: 'ordering_authority_source_decision_missing' })],
    });
  });

  it('keeps membership display-only when the resolved decision comparator does not match the request', async () => {
    configureUnresolvedTypedParticipantSources(content);
    const openDecision = content.sourceDecisions[0];
    if (!openDecision) throw new Error('Synthetic open decision required');
    content.sourceDecisions = [
      {
        ...openDecision,
        status: 'RESOLVED',
        decision: 'Use rank seniority as the reviewed synthetic comparator.',
        resolution: {
          v: 1,
          kind: 'BID_ORDERING_COMPARATOR',
          comparator: [{ key: 'RANK_SENIORITY', direction: 'ASC' }],
        },
      },
    ];
    const before = h.sqlite.serialize();
    const response = await post(`bid/${year}/preview`, {
      kind: 'stage-participant-membership',
      expected: { kind: 'legacy', sourceToken },
      intent: { operation: 'save', content },
    });
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = (await response.json()) as {
      valid: boolean;
      membership: { status: string };
      orderingAuthority: { status: string; code?: string };
      stages: Array<{ matchedMemberIds: number[]; displayOrder: string }>;
      executionReady: boolean;
      executionIssues: string[];
    };
    expect(result.valid).toBe(true);
    expect(result.membership).toEqual({ status: 'RESOLVED_FOR_PREVIEW' });
    expect(result.stages.map((stage) => stage.matchedMemberIds)).toEqual([[10002, 10003], [10001]]);
    expect(result.stages.every((stage) => stage.displayOrder === 'MEMBER_ID_ASC')).toBe(true);
    expect(result.orderingAuthority).toMatchObject({
      status: 'UNRESOLVED',
      code: 'ordering_authority_comparator_mismatch',
    });
    expect(result.executionReady).toBe(false);
    expect(result.executionIssues).toEqual(['ordering_authority_comparator_mismatch']);
  });

  it('rejects a Department source race rather than returning a mixed participant preview', async () => {
    configureUnresolvedTypedParticipantSources(content);
    let raced = false;
    let afterRace: Buffer | undefined;
    const original = h.env.DB.prepare.bind(h.env.DB);
    vi.spyOn(h.env.DB, 'prepare').mockImplementation((sql) => {
      const statement = original(sql);
      if (!raced && /from\s+"members"/i.test(sql)) {
        const raw = statement.raw.bind(statement);
        vi.spyOn(statement, 'raw').mockImplementation(async <T = unknown[]>() => {
          const rows = await raw<T>();
          h.sqlite.prepare('UPDATE members SET rsc_seniority=? WHERE id=?').run(99, 10001);
          raced = true;
          afterRace = h.sqlite.serialize();
          return rows;
        });
      }
      return statement;
    });
    const response = await post(`bid/${year}/preview`, {
      kind: 'stage-participant-membership',
      expected: { kind: 'legacy', sourceToken },
      intent: { operation: 'save', content },
    });
    expect(raced).toBe(true);
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: 'bid_definition_or_source_changed' });
    deepStrictEqual(h.sqlite.serialize(), afterRace);
  });

  it('freezes rank ordering only from the matching resolved annual-policy decision and exposes it to Live readiness', async () => {
    if (!content.policy) throw new Error('V3 policy fixture required');
    h.sqlite
      .prepare('UPDATE members SET rsc_seniority=?, rank_seniority=? WHERE id=?')
      .run(1, 9, 10002);
    h.sqlite
      .prepare('UPDATE members SET rsc_seniority=?, rank_seniority=? WHERE id=?')
      .run(2, 1, 10003);
    const refreshedSource = await captureBidDefinitionSource(h.env.DB, year);
    if (!refreshedSource.ok) throw new Error(JSON.stringify(refreshedSource));
    sourceToken = refreshedSource.sourceToken;
    const comparator = [{ key: 'RANK_SENIORITY' as const, direction: 'ASC' as const }];
    content.policy.stageParticipantSources = [
      {
        stageId: 'EARLIER',
        sourceRef: 'Synthetic Earlier-stage roster',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [10002, 10003] },
        ordering: comparator,
      },
      {
        stageId: 'LATER',
        sourceRef: 'Synthetic Later-stage roster',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [10001] },
        ordering: comparator,
      },
    ];
    content.policy.orderingAuthority = {
      v: 1,
      sourceDecisionId: 'synthetic-governing-ordering-decision',
      comparator,
    };
    content.sourceDecisions = [
      {
        issueId: 'synthetic-governing-ordering-decision',
        title: 'Synthetic annual ordering authority',
        question: 'Which comparator controls the synthetic annual Bid order?',
        area: 'annual-policy',
        status: 'RESOLVED',
        decision: 'Use the reviewed synthetic rank-seniority comparator.',
        sourceRef: 'Synthetic governing annual-policy source evidence.',
        effectiveOn: `${year}-01-01`,
        resolution: { v: 1, kind: 'BID_ORDERING_COMPARATOR', comparator },
      },
    ];

    const version = await saved();
    const prepared = await prepare(version);
    if (!prepared.ok || prepared.snapshot.settings.v !== 3)
      throw new Error(JSON.stringify(prepared));
    expect(prepared.snapshot.settings.livePolicy.orderingAuthority).toEqual({
      v: 1,
      comparator,
      sourceDecision: {
        issueId: 'synthetic-governing-ordering-decision',
        effectiveOn: `${year}-01-01`,
      },
    });
    expect(
      computeFrozenStageOrder(prepared.snapshot, prepared.snapshot.settings.livePolicy),
    ).toEqual({
      ok: true,
      entries: [
        { ordinal: 1, memberId: 10003, stageId: 'EARLIER' },
        { ordinal: 2, memberId: 10002, stageId: 'EARLIER' },
        { ordinal: 3, memberId: 10001, stageId: 'LATER' },
      ],
    });

    const session = await createMock(version);
    const frozen = await readOnly(() => loadFrozenSessionBidPolicy(getDb(h.env.DB), session.id));
    if (!frozen.ok) throw new Error(JSON.stringify(frozen));
    const readiness = await readOnly(() =>
      evaluateLiveBidReadiness({
        db: getDb(h.env.DB),
        env: h.env,
        bidSessionId: session.id,
        bidYear: year,
        frozenPolicy: frozen,
        operatorAuthorized: false,
      }),
    );
    expect(readiness.checks.find((entry) => entry.id === 'ordering_authority')?.status).toBe(
      'READY',
    );
  });

  it('fails closed when typed sources resolve an excluded pinned member', async () => {
    if (!content.policy) throw new Error('V3 policy fixture required');
    content.policy.stageParticipantSources = [
      {
        stageId: 'EARLIER',
        sourceRef: 'Synthetic Earlier-stage roster',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [10002, 10004] },
        ordering: [{ key: 'RANK_SENIORITY', direction: 'ASC' }],
      },
      {
        stageId: 'LATER',
        sourceRef: 'Synthetic Later-stage roster',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [10001] },
        ordering: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
      },
    ];
    expect(await prepare(await saved())).toMatchObject({
      ok: false,
      code: 'stage_authoring_member_not_participant',
      stageId: 'EARLIER',
      memberIds: [10004],
    });
  });

  it.each([
    'duplicate id',
    'duplicate order',
    'duplicate member',
    'annual mismatch',
    'unknown opportunity',
    'reserved opportunity',
  ] as const)('rejects %s at the actual saved-definition boundary without writes', async (kind) => {
    if (content.settings?.v !== 3 || !content.policy) throw new Error('V3 fixture required');
    const execution = content.settings.livePolicy;
    const later = stageById(execution, 'LATER');
    if (kind === 'duplicate id') later.id = 'EARLIER';
    if (kind === 'duplicate order') later.order = 10;
    if (kind === 'duplicate member') later.memberIds = [10002];
    if (kind === 'annual mismatch') annualPolicy(execution).stageOrder = ['LATER', 'EARLIER'];
    if (kind === 'unknown opportunity') later.opportunityPositionIds = ['synthetic-missing'];
    if (kind === 'reserved opportunity') later.opportunityPositionIds = [RESERVED];
    content.policy.executionPolicy = execution;
    expect(await readOnly(() => save())).toMatchObject({
      ok: false,
      error: 'invalid_bid_definition',
    });
  });

  it.each([
    { kind: 'unknown', code: 'stage_member_not_in_snapshot' },
    { kind: 'excluded', code: 'stage_member_excluded' },
    { kind: 'omitted', code: 'stage_coverage_incomplete' },
  ] as const)(
    'rejects an $kind member at the actual start boundary without writes',
    async ({ kind, code }) => {
      if (content.settings?.v !== 3 || !content.policy) throw new Error('V3 fixture required');
      stageById(content.settings.livePolicy, 'EARLIER').memberIds =
        kind === 'omitted' ? [10002] : [10002, kind === 'unknown' ? 19999 : 10004];
      content.policy.executionPolicy = content.settings.livePolicy;
      // Incomplete member populations are saveable drafts; execution must remain
      // blocked even after an administrator creates a configuration-only Mock.
      const session = await createMock(await saved());
      const response = await readOnly(() => post(`bid-session/${session.id}/start`, {}));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: 'live_stage_order_unavailable',
        policy_error: code,
      });
    },
  );

  it('prepares the immutable saved custom stages without changing legacy publication state', async () => {
    expect(await prepare(await saved(), 'live')).toMatchObject({
      ok: true,
    });
  });
});
