import { deepStrictEqual } from 'node:assert';
import {
  type BidDefinitionContent,
  BidDispositionSchema,
  BidEvidenceFreezeSchema,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  RetainedParticipationPreviewRequestSchema,
  RetainedParticipationPreviewResponseSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { app } from '../../src/index.js';
import { definitionRuleBookMaterial } from '../../src/lib/bid-definition-content.js';
import { prepareBidDefinitionRun } from '../../src/lib/bid-definition-run.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import {
  loadBidDefinitionHead,
  loadBidDefinitionVersion,
} from '../../src/lib/bid-definition-version.js';
import { evidenceFreezeDigests, evidenceSourceDigests } from '../../src/lib/bid-evidence-freeze.js';
import {
  evaluateRuleBookCoverage,
  loadBidEvaluationEvidence,
  prepareCapturedBidEvaluation,
} from '../../src/lib/bid-policy.js';
import { signJwt } from '../../src/lib/jwt.js';
import {
  previewRetainedParticipation,
  retainedParticipationSourceDecisionIssue,
} from '../../src/lib/retained-participation-preview.js';
import { createRetainedParticipationReceipt } from '../../src/lib/retained-participation-receipt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const HOLDER = 94001;
const OTHER = 94002;
const OPEN = 'synthetic-retention-open-seat';
const CLOSED = 'synthetic-retention-closed-seat';
const STAFFING = 'synthetic-retention-staffing';
const CAPTURED = Date.parse('2026-09-30T22:00:00Z');
type Version = Extract<Awaited<ReturnType<typeof loadBidDefinitionVersion>>, { ok: true }>;

// Deliberately historical synthetic normalized evidence is seeded once, then
// every successor is authored through the normal audited semantic Save.
// Preparation is real D1/SQLite, not a mocked loader or recomputed member body.
describe('immutable retained participation successor preparation', () => {
  let h: TestD1;
  let counter: number;
  beforeEach(async () => {
    h = await setupTestD1();
    counter = 0;
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,rank_seniority,
        employment_status,employment_status_effective_on,is_probationary,created_at,updated_at)
      VALUES (${HOLDER},'synthetic-retention-holder','Synthetic','Holder','LT','OFC',1,1,'active','2020-01-01',0,1,1),
        (${OTHER},'synthetic-retention-bidder','Synthetic','Bidder','LT','OFC',2,2,'active','2020-01-01',0,1,1);
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2026.synthetic.retention',2026,'Synthetic topology');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2026.synthetic.retention',2026,'draft',1,'Synthetic source');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
      VALUES (2026,'configuring','2026.synthetic.retention','2026.synthetic.retention',1,
        '{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2026-09-30","personnelEvaluationOn":"2026-09-30"}');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
      VALUES ('${OPEN}','2026.synthetic.retention','A','7','Combat','Synthetic Engine','LT','Synthetic LT'),
        ('${CLOSED}','2026.synthetic.retention','D','7','Administration','Synthetic Training','LT','Synthetic Training LT');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
      VALUES ('2026.synthetic.retention','${OPEN}','2026.synthetic.retention','{"rank":["LT"],"credentials":[],"custom":[]}',
        '{"max":0,"items":[]}','["rank_seniority"]');
      INSERT INTO rule_book_position_participation (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
      VALUES ('2026.synthetic.retention','${CLOSED}','2026.synthetic.retention','RESERVED_NON_BIDDABLE','Synthetic reviewed annual closure',1);
      INSERT INTO staffing_positions (id,stable_slot_key,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at)
      VALUES ('${STAFFING}','SYNTHETIC/D/TRAINING','D','7','Synthetic Training','Synthetic Training LT','LT','2026-01-01','approved',1,1);
      INSERT INTO position_staffing_bindings (position_id,template_version,staffing_position_id,authoritative_source_ref,review_status,created_at)
      VALUES ('${CLOSED}','2026.synthetic.retention','${STAFFING}','Synthetic reviewed closed holder binding','approved',1);
      INSERT INTO member_assignments (id,member_id,staffing_position_id,origin_type,origin_ref,status,effective_from,created_at,updated_at)
      VALUES ('synthetic-retention-assignment',${HOLDER},'${STAFFING}','ADMIN_TRANSFER','Synthetic reviewed assignment','active','2026-01-01',1,1);
      INSERT INTO credentials (id,name) VALUES (94001,'Synthetic withheld qualification');
      INSERT INTO member_credentials (member_id,credential_id,start_date,expiration_date)
      VALUES (${OTHER},94001,'2020-01-01',NULL);
    `);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  async function saved(content: BidDefinitionContent): Promise<Version> {
    const head = await loadBidDefinitionHead(h.env.DB, 2026);
    const previous = head ? await loadBidDefinitionVersion(h.env.DB, 2026, head.versionId) : null;
    const source = await captureBidDefinitionSource(h.env.DB, 2026);
    if (!source.ok || (previous && !previous.ok)) throw new Error('Synthetic save source missing');
    const result = await saveBidDefinition(h.env.DB, {
      year: 2026,
      key: `synthetic-retention-save-${++counter}`,
      actorSubject: 'synthetic-editor',
      actorId: OTHER,
      expected:
        head && previous?.ok
          ? {
              kind: 'version',
              versionId: head.versionId,
              revision: head.revision,
              sha256: previous.sha256,
            }
          : { kind: 'legacy', sourceToken: source.sourceToken },
      reason: 'Synthetic source-bound retained participation successor',
      intent: { operation: 'save', content },
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    const next = await loadBidDefinitionHead(h.env.DB, 2026);
    if (!next) throw new Error('Synthetic saved head missing');
    const version = await loadBidDefinitionVersion(h.env.DB, 2026, next.versionId);
    if (!version.ok) throw new Error(JSON.stringify(version));
    return version;
  }

  async function sourceFixture() {
    const capture = await captureBidDefinitionSource(h.env.DB, 2026);
    if (!capture.ok) throw new Error('Synthetic source capture missing');
    const content = structuredClone(capture.content);
    const policy = FrozenLiveBidPolicySchema.parse({
      v: 1,
      policyRevision: 'synthetic-retention-policy',
      stages: [
        {
          id: 'synthetic-lieutenants',
          label: 'Synthetic Lieutenants',
          order: 1,
          memberIds: [HOLDER, OTHER],
          opportunityPositionIds: [OPEN],
          kind: 'LIEUTENANT',
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
        actorMemberIds: [OTHER],
      })),
      specialtyCatalogReference: null,
      aDayPolicyReference: null,
      transitionPolicyReference: null,
      publicationPolicyReference: null,
      annualOperations: {
        v: 1,
        stageOrder: ['synthetic-lieutenants'],
        requiredTopologyPositionIds: [OPEN],
        assignmentTerms: [
          {
            id: 'synthetic-closed-term',
            positionIds: [CLOSED],
            requiredServiceMonths: 36,
            reopenAfterConsecutiveCycles: 3,
            closedForThisBid: true,
            sourceRef: 'Synthetic reviewed annual closure',
          },
        ],
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
    content.settings = {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2026-09-30',
      personnelEvaluationOn: '2026-09-30',
      evidenceCutoffAt: '2026-09-30T17:00:00-04:00',
      livePolicy: policy,
    };
    content.policy = {
      policyText: 'Synthetic reviewed reserved retention procedure.',
      executionPolicy: policy,
    };
    content.sourceDecisions = [
      {
        issueId: '2026-latest-lieutenant-capacity',
        area: 'positions',
        status: 'RESOLVED',
        title: 'Synthetic reviewed retained LT capacity',
        question: 'Does the synthetic retained cohort fit the synthetic open seat?',
        decision: 'Reviewed synthetic retention leaves one ordinary LT and one open LT seat.',
        sourceRef: 'Synthetic source-reviewed closed holder and open LT topology',
        effectiveOn: '2026-09-30',
        blockingClassification: 'BLOCKS_REAL_BID_ACTIVATION',
        affectedScopes: ['lieutenants'],
      },
    ];
    const originalVersion = await saved(content);
    if (!originalVersion.content.settings || originalVersion.content.settings.v === 1)
      throw new Error('Synthetic saved normalized settings missing');
    const evidence = await loadBidEvaluationEvidence(getDb(h.env.DB), 2026);
    const material = definitionRuleBookMaterial(
      originalVersion.content,
      originalVersion.row.rule_book_version,
      originalVersion.row.position_template_version,
    );
    const coverage = evaluateRuleBookCoverage({
      ruleBookVersion: originalVersion.row.rule_book_version,
      declaredTemplateVersion: originalVersion.row.position_template_version,
      rules: material.rules,
      positions: material.positions,
    });
    const prepared = await prepareCapturedBidEvaluation(
      getDb(h.env.DB),
      {
        bidYear: 2026,
        settings: originalVersion.content.settings,
        coverage,
        ruleBookMaterial: material,
        bindings: originalVersion.content.staffingBindings,
        sourceDecisions: originalVersion.content.sourceDecisions,
        policyReferenceJson: material.rules.flatMap((rule) => [
          rule.requiredCriteriaJson,
          rule.pointsPreferenceJson,
        ]),
      },
      evidence,
      CAPTURED,
      'mock',
    );
    if (!prepared.ok) throw new Error(JSON.stringify(prepared));
    const original = structuredClone(prepared.evaluation);
    const holder = original.members.find((member) => member.memberId === HOLDER);
    const bidder = original.members.find((member) => member.memberId === OTHER);
    if (!holder || !bidder) throw new Error('Synthetic original members missing');
    holder.pool = 'OFC';
    holder.exclusionReason = null;
    holder.authoritativeAssignmentId = null;
    // Simulate the original sealed review hold effect, deliberately absent
    // from the archived raw credential document. Never author this as a new fact.
    bidder.credentialNames = [];
    if (bidder.scoringEvidence) bidder.scoringEvidence.completedCredentialNames = [];
    const evalDigests = evidenceFreezeDigests(original);
    const sources = evidenceSourceDigests(evidence);
    const imports = [
      {
        source: 'synthetic',
        importId: 'synthetic-reviewed-source',
        revision: '1',
        sha256: 'a'.repeat(64),
        acceptedAt: '2026-09-29T12:00:00Z',
      },
    ];
    const row = {
      id: 'synthetic-retention-freeze',
      bid_year: 2026,
      cutoff_at: '2026-09-30T17:00:00-04:00',
      time_zone: 'America/New_York',
      captured_at: CAPTURED,
      actor_subject: 'synthetic-editor',
      source_version_id: originalVersion.row.id,
      source_version_sha256: originalVersion.sha256,
      source_token: 'b'.repeat(64),
      evaluation_json: evalDigests.evaluationJson,
      personnel_source_json: sources.personnelSourceJson,
      credential_source_json: sources.credentialSourceJson,
      evaluation_sha256: evalDigests.evaluationSha256,
      personnel_sha256: sources.personnelSha256,
      credential_sha256: sources.credentialSha256,
      source_imports_json: JSON.stringify(imports),
    };
    const keys = Object.keys(row) as Array<keyof typeof row>;
    h.sqlite
      .prepare(
        `INSERT INTO bid_evidence_freezes (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
      )
      .run(...keys.map((key) => row[key]));
    if (content.settings.v !== 3) throw new Error('Synthetic settings missing');
    content.settings.evidenceFreeze = BidEvidenceFreezeSchema.parse({
      freezeId: row.id,
      evaluationSha256: row.evaluation_sha256,
      sourceVersionId: row.source_version_id,
      sourceVersionSha256: row.source_version_sha256,
      evidenceCutoffAt: row.cutoff_at,
      timeZone: row.time_zone,
      approvedAt: new Date(CAPTURED).toISOString(),
      sourceImports: imports,
      personnelSnapshot: {
        sha256: row.personnel_sha256,
        asOfAt: row.cutoff_at,
        capturedAt: new Date(CAPTURED).toISOString(),
      },
      credentialSnapshot: {
        sha256: row.credential_sha256,
        asOfAt: row.cutoff_at,
        capturedAt: new Date(CAPTURED).toISOString(),
      },
    });
    const baseline = await saved(content);
    const receipt = createRetainedParticipationReceipt({
      baseline: { id: baseline.row.id, sha256: baseline.sha256, content: baseline.content },
      original,
      recomputed: prepared.evaluation,
      evidence,
      source: row as Parameters<typeof createRetainedParticipationReceipt>[0]['source'],
    });
    if (!receipt.ok) throw new Error('Synthetic receipt derivation failed');
    return { baseline, originalVersion, original, receipt, row };
  }

  async function prepare(version: Version) {
    const before = h.sqlite.serialize();
    const result = await prepareBidDefinitionRun(h.env.DB, {
      year: 2026,
      versionId: version.row.id,
      versionSha256: version.sha256,
      bidSessionId: `synthetic-retention-session-${version.row.id}`,
      capturedAtMs: CAPTURED + 60_000,
      mode: 'mock',
    });
    deepStrictEqual(h.sqlite.serialize(), before);
    return result;
  }

  function expected(version: Version) {
    return {
      kind: 'version' as const,
      versionId: version.row.id,
      revision: version.row.version_number,
      sha256: version.sha256,
    };
  }

  async function preview(version: Version, body: unknown = { expected: expected(version) }) {
    const before = h.sqlite.serialize();
    const result = await previewRetainedParticipation(h.env.DB, 2026, body);
    deepStrictEqual(h.sqlite.serialize(), before);
    return result;
  }

  async function previewRequest(
    body: unknown,
    role: 'admin' | 'member' | null = 'admin',
    fresh = true,
  ) {
    const auth =
      role === null
        ? null
        : await signJwt(
            {
              sub: OTHER,
              emp: 'synthetic-retention-bidder',
              role,
              rank: 'LT',
              first_name: 'Synthetic',
              last_name: 'Bidder',
              fresh_auth_at: Math.floor(Date.now() / 1000) - (fresh ? 0 : 86_400),
            },
            h.env.JWT_SIGNING_KEY,
          );
    const before = h.sqlite.serialize();
    const response = await app.fetch(
      new Request('http://x/api/admin/bid/2026/retained-participation/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        },
        body: JSON.stringify(body),
      }),
      h.env,
    );
    deepStrictEqual(h.sqlite.serialize(), before);
    return response;
  }

  it('returns a source-bound read-only proposal whose ordinary Save preserves sealed withheld qualifications', async () => {
    const fixture = await sourceFixture();
    const response = await previewRequest({ expected: expected(fixture.baseline) });
    expect(response.status).toBe(200);
    const result = RetainedParticipationPreviewResponseSchema.parse(await response.json());
    expect(result.content).toEqual(fixture.receipt.content);
    expect(result.expected).toEqual(expected(fixture.baseline));
    expect(result.beforeCounts).toEqual({
      ordinaryParticipants: 2,
      stageEntries: 2,
      ranks: { CPT: 0, LT: 2, FF: 0 },
    });
    expect(result.counts).toEqual({
      ordinaryParticipants: 1,
      stageEntries: 1,
      ranks: { CPT: 0, LT: 1, FF: 0 },
    });
    expect(result.retained).toEqual([
      { memberId: HOLDER, rank: 'LT', positionId: CLOSED, displayName: 'Synthetic Holder' },
    ]);
    expect(result.retainedCount).toBe(1);
    expect(result.source.freezeId).toBe(fixture.row.id);
    const successor = await saved(result.content);
    expect(successor.sha256).toBe(result.proposalSha256);
    const prepared = await prepare(successor);
    if (!prepared.ok) throw new Error(JSON.stringify(prepared));
    expect(prepared.snapshot.members.find((m) => m.memberId === OTHER)).toEqual(
      fixture.original.members.find((m) => m.memberId === OTHER),
    );
    expect(prepared.snapshot.members.find((m) => m.memberId === OTHER)?.credentialNames).toEqual(
      [],
    );
    expect(prepared.snapshot.members.find((m) => m.memberId === HOLDER)?.pool).toBe('EXCLUDED');
  });

  it('requires admin authentication, while a read-only preview needs no new step-up or idempotency key', async () => {
    const fixture = await sourceFixture();
    const body = { expected: expected(fixture.baseline) };
    expect((await previewRequest(body, null)).status).toBe(401);
    expect((await previewRequest(body, 'member')).status).toBe(403);
    expect((await previewRequest(body, 'admin', false)).status).toBe(200);
  });

  it.each(['memberIds', 'original', 'recomputed', 'content', 'reason', 'freezeId'])(
    'rejects caller-supplied %s without source writes',
    async (field) => {
      const fixture = await sourceFixture();
      const body = { expected: expected(fixture.baseline), [field]: [] };
      expect(RetainedParticipationPreviewRequestSchema.safeParse(body).success).toBe(false);
      expect((await previewRequest(body)).status).toBe(400);
    },
  );

  it.each(['versionId', 'revision', 'sha256'])(
    'rejects a stale current-head %s with no writes',
    async (field) => {
      const fixture = await sourceFixture();
      const selected = {
        ...expected(fixture.baseline),
        [field]:
          field === 'revision'
            ? fixture.baseline.row.version_number + 1
            : field === 'sha256'
              ? 'f'.repeat(64)
              : fixture.originalVersion.row.id,
      };
      expect(await preview(fixture.baseline, { expected: selected })).toEqual({
        ok: false,
        error: 'retained_participation_source_changed',
      });
    },
  );

  it.each(['absent', 'wrong-freeze', 'existing-derivation', 'reviewed-update'])(
    'rejects an %s original pin',
    async (kind) => {
      const fixture = await sourceFixture();
      const content = structuredClone(
        kind === 'existing-derivation' ? fixture.receipt.content : fixture.baseline.content,
      );
      if (content.settings?.v !== 3) throw new Error('Synthetic settings missing');
      if (kind === 'absent') {
        const { evidenceFreeze: _pin, ...withoutPin } = content.settings;
        content.settings = withoutPin;
      }
      if (kind === 'wrong-freeze' && content.settings.evidenceFreeze)
        content.settings.evidenceFreeze.freezeId = 'synthetic-unavailable-freeze';
      if (kind === 'reviewed-update' && content.settings.evidenceFreeze) {
        const pin = content.settings.evidenceFreeze;
        const at = new Date(CAPTURED).toISOString();
        pin.personnelSnapshot.asOfAt = at;
        pin.credentialSnapshot.asOfAt = at;
        pin.reviewedUpdate = {
          v: 1,
          kind: 'APPROVED_LEDGER_UPDATE',
          observedAsOfAt: at,
          originalFreezeId: fixture.row.id,
          originalEvaluationSha256: fixture.row.evaluation_sha256,
          originalPersonnelSha256: fixture.row.personnel_sha256,
          originalCredentialSha256: fixture.row.credential_sha256,
          sourceToken: 'b'.repeat(64),
          reasonSha256: 'c'.repeat(64),
          sourceDecisionsSha256: 'd'.repeat(64),
        };
      }
      const version = await saved(content);
      expect(await preview(version)).toEqual({
        ok: false,
        error: 'retained_participation_original_pin_required',
      });
    },
  );

  it('preserves both normally resolved and still-open source decisions without approving either', async () => {
    const fixture = await sourceFixture();
    const content = structuredClone(fixture.baseline.content);
    const decision = {
      issueId: '2026-latest-lieutenant-capacity',
      area: 'positions' as const,
      status: 'RESOLVED' as const,
      title: 'Synthetic reviewed retained LT capacity',
      question: 'Does the synthetic retained cohort fit the synthetic open seat?',
      decision:
        'Reviewed synthetic retention leaves one eligible ordinary LT and one open LT seat.',
      sourceRef: 'Synthetic source-reviewed closed holder and open LT topology',
      effectiveOn: '2026-09-30',
      blockingClassification: 'BLOCKS_REAL_BID_ACTIVATION' as const,
      affectedScopes: ['lieutenants'],
    };
    content.sourceDecisions = [
      decision,
      { ...decision, issueId: 'synthetic-still-open-evidence', status: 'OPEN' },
    ];
    const version = await saved(content);
    const result = await preview(version);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.content.sourceDecisions).toEqual(version.content.sourceDecisions);
    expect(
      result.content.sourceDecisions.find((d) => d.issueId === 'synthetic-still-open-evidence')
        ?.status,
    ).toBe('OPEN');
    expect(
      result.content.settings?.v === 3 &&
        result.content.settings.evidenceFreeze?.derivation?.baselineVersionId,
    ).toBe(version.row.id);
    expect(
      result.content.settings?.v === 3 &&
        result.content.settings.evidenceFreeze?.derivation?.baselineVersionSha256,
    ).toBe(version.sha256);
  });

  it.each(['OPEN', 'missing'])(
    'requires normal review and Save of the unique LT capacity decision when %s',
    async (kind) => {
      const fixture = await sourceFixture();
      const content = structuredClone(fixture.baseline.content);
      if (kind === 'missing') content.sourceDecisions = [];
      else {
        const decision = content.sourceDecisions[0];
        if (!decision) throw new Error('Synthetic LT capacity decision missing');
        decision.status = 'OPEN';
      }
      const version = await saved(content);
      const response = await previewRequest({ expected: expected(version) });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        ok: false,
        error: 'retained_participation_source_decision_required',
      });
      expect((await loadBidDefinitionVersion(h.env.DB, 2026, version.row.id)).ok).toBe(true);
      expect(version.content.sourceDecisions).toEqual(content.sourceDecisions);
    },
  );

  it('requires a unique reviewed LT source decision even when both duplicate records claim resolution', async () => {
    const fixture = await sourceFixture();
    const content = structuredClone(fixture.baseline.content);
    const decision = content.sourceDecisions[0];
    if (!decision) throw new Error('Synthetic LT capacity decision missing');
    content.sourceDecisions.push({ ...decision });
    expect(retainedParticipationSourceDecisionIssue(content)).toBe(
      'retained_participation_source_decision_required',
    );
    // The ordinary immutable loader already rejects duplicated issue IDs;
    // the preview guard independently retains that uniqueness boundary.
    const before = h.sqlite.serialize();
    await expect(saved(content)).rejects.toThrow('invalid_bid_definition');
    deepStrictEqual(h.sqlite.serialize(), before);
  });

  it.each(['proposal-extra', 'source-pin', 'duplicate-retained', 'rank-count'])(
    'shared proposal validation rejects %s response transport tampering',
    async (kind) => {
      const fixture = await sourceFixture();
      const result = await preview(fixture.baseline);
      if (!result.ok) throw new Error(JSON.stringify(result));
      const changed = structuredClone(result);
      if (kind === 'proposal-extra') Object.assign(changed, { unapprovedMemberIds: [OTHER] });
      if (
        kind === 'source-pin' &&
        changed.content.settings?.v === 3 &&
        changed.content.settings.evidenceFreeze
      )
        changed.content.settings.evidenceFreeze.freezeId = 'synthetic-wrong-transport-pin';
      if (kind === 'duplicate-retained') {
        const retained = changed.retained[0];
        if (!retained) throw new Error('Synthetic retained member missing');
        changed.retained.push({ ...retained });
      }
      if (kind === 'rank-count') changed.counts.ranks.LT++;
      expect(RetainedParticipationPreviewResponseSchema.safeParse(changed).success).toBe(false);
    },
  );

  it.each(['evaluation', 'personnel', 'credential', 'capture-source', 'material'])(
    'rejects altered %s bindings before returning a proposal',
    async (kind) => {
      const fixture = await sourceFixture();
      const content = structuredClone(fixture.baseline.content);
      const pin = content.settings?.v === 3 ? content.settings.evidenceFreeze : undefined;
      if (!pin) throw new Error('Synthetic original pin missing');
      if (kind === 'evaluation') pin.evaluationSha256 = 'f'.repeat(64);
      if (kind === 'personnel') pin.personnelSnapshot.sha256 = 'f'.repeat(64);
      if (kind === 'credential') pin.credentialSnapshot.sha256 = 'f'.repeat(64);
      if (kind === 'capture-source') pin.sourceVersionSha256 = 'f'.repeat(64);
      if (kind === 'material') {
        const rule = content.rules[0];
        if (!rule) throw new Error('Synthetic position rule missing');
        rule.requiredCriteriaJson =
          '{"rank":["LT"],"credentials":["Synthetic withheld qualification"],"custom":[]}';
      }
      const version = await saved(content);
      expect(await preview(version)).toEqual({
        ok: false,
        error: 'retained_participation_preview_failed',
      });
    },
  );

  it('rejects a head change during the complete read-only preparation', async () => {
    const fixture = await sourceFixture();
    const originalPrepare = h.env.DB.prepare.bind(h.env.DB);
    let headReads = 0;
    vi.spyOn(h.env.DB, 'prepare').mockImplementation((query) => {
      const stmt = originalPrepare(query);
      if (query.includes('SELECT version_id AS versionId,revision FROM bid_definition_heads')) {
        const originalBind = stmt.bind.bind(stmt);
        stmt.bind = ((...args: unknown[]) => {
          const bound = originalBind(...args);
          const first = bound.first.bind(bound);
          bound.first = (async (...firstArgs: unknown[]) => {
            const value = await first(...(firstArgs as []));
            headReads++;
            return headReads > 1
              ? {
                  versionId: fixture.baseline.row.id,
                  revision: fixture.baseline.row.version_number + 1,
                }
              : value;
          }) as typeof bound.first;
          return bound;
        }) as typeof stmt.bind;
      }
      return stmt;
    });
    expect(await preview(fixture.baseline)).toEqual({
      ok: false,
      error: 'retained_participation_source_changed',
    });
  });

  it('keeps the absent-receipt legacy frozen cohort while a normal successor changes only proved retention', async () => {
    const fixture = await sourceFixture();
    const legacy = await prepare(fixture.baseline);
    if (!legacy.ok) throw new Error(JSON.stringify(legacy));
    expect(legacy, 'Legacy frozen preparation must remain valid').toMatchObject({ ok: true });
    if (!legacy.ok) return;
    expect(legacy.snapshot.members.find((member) => member.memberId === HOLDER)?.pool).toBe('OFC');
    const successor = await saved(fixture.receipt.content);
    const current = await prepare(successor);
    if (!current.ok) throw new Error(JSON.stringify(current));
    expect(current, 'Verified successor preparation must be valid').toMatchObject({ ok: true });
    if (!current.ok) return;
    expect(current.snapshot.members.find((member) => member.memberId === HOLDER)).toMatchObject({
      pool: 'EXCLUDED',
      exclusionReason: 'ADMIN_ASSIGNED_NON_BIDDABLE',
      authoritativeAssignmentId: 'synthetic-retention-assignment',
    });
    expect(current.snapshot.members.find((member) => member.memberId === OTHER)).toEqual(
      fixture.original.members.find((member) => member.memberId === OTHER),
    );
    expect(
      current.snapshot.settings.v === 3 &&
        current.snapshot.settings.livePolicy.stages[0]?.memberIds,
    ).toEqual([OTHER]);
    expect(
      h.sqlite.prepare('SELECT * FROM bid_evidence_freezes WHERE id=?').get(fixture.row.id),
    ).toEqual(fixture.row);
    const old = await prepare(fixture.baseline);
    if (!old.ok) throw new Error(JSON.stringify(old));
    expect(old.snapshotJson).toBe(legacy.snapshotJson);
    expect(old.pins).toEqual(legacy.pins);
  });

  it.each(['digest', 'policy', 'baseline', 'source-version'])(
    'rejects a saved successor with tampered %s proof',
    async (kind) => {
      const fixture = await sourceFixture();
      const content = structuredClone(fixture.receipt.content);
      const derivation =
        content.settings?.v === 3 ? content.settings.evidenceFreeze?.derivation : undefined;
      if (!derivation || content.settings?.v !== 3) throw new Error('Synthetic derivation missing');
      if (kind === 'digest') derivation.derivedEvaluationSha256 = 'f'.repeat(64);
      if (kind === 'policy')
        content.policy = content.policy
          ? { ...content.policy, policyText: 'Changed unrelated synthetic policy facts.' }
          : null;
      if (kind === 'baseline') derivation.baselineVersionId = fixture.originalVersion.row.id;
      if (kind === 'source-version') derivation.sourceVersionSha256 = 'f'.repeat(64);
      const version = await saved(content);
      expect(await prepare(version)).toMatchObject({
        ok: false,
        code: 'bid_evidence_freeze_integrity_failed',
      });
    },
  );
});
