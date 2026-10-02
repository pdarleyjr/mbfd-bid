import { deepStrictEqual } from 'node:assert';
import {
  type BidDefinitionContent,
  BidDispositionSchema,
  BidEvidenceFreezeSchema,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { app } from '../../src/index.js';
import {
  LATEST_2026_ANNUAL_HASH,
  LATEST_2026_MASTER_HASH,
  OCTOBER1_2026_ANNUAL_HASH,
} from '../../src/lib/2026-latest-source-cutoff.js';
import {
  canonicalBidDefinition,
  definitionRuleBookMaterial,
} from '../../src/lib/bid-definition-content.js';
import { prepareBidDefinitionRun } from '../../src/lib/bid-definition-run.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import {
  loadBidDefinitionHead,
  loadBidDefinitionVersion,
} from '../../src/lib/bid-definition-version.js';
import { loadBidEvidenceFreeze } from '../../src/lib/bid-evidence-freeze.js';
import { evidenceFreezeDigests, evidenceSourceDigests } from '../../src/lib/bid-evidence-freeze.js';
import {
  loadPinnedBidEvidenceFreeze,
  loadReviewedBidEvidenceUpdate,
} from '../../src/lib/bid-evidence-reviewed-update-storage.js';
import {
  captureReviewedBidEvidenceUpdate,
  previewReviewedBidEvidenceUpdate,
} from '../../src/lib/bid-evidence-reviewed-update.js';
import {
  evaluateRuleBookCoverage,
  loadBidEvaluationEvidence,
  prepareCapturedBidEvaluation,
} from '../../src/lib/bid-policy.js';
import { signJwt } from '../../src/lib/jwt.js';
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
describe('append-only reviewed evidence updates and ordinary successor authoring', () => {
  let h: TestD1;
  let counter: number;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(CAPTURED);
    h = await setupTestD1();
    h.env.PORTAL_WRITEBACK_ENABLED = 'false';
    counter = 0;
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,rank_seniority,
        employment_status,employment_status_effective_on,is_probationary,created_at,updated_at)
      VALUES (${HOLDER},'synthetic-retention-holder','Synthetic','Holder','LT','OFC',1,1,'active','2020-01-01',0,1,1),
        (${OTHER},'17836','Synthetic','Bidder','LT','OFC',2,2,'active','2020-01-01',0,1,1),
        (94003,'17594','Synthetic','Captain','CPT','OFC',3,3,'active','2020-01-01',0,1,1),
        (94004,'18148','Synthetic','Chief','DC','EXCLUDED',4,4,'active','2020-01-01',0,1,1);
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2026.synthetic.retention',2026,'Synthetic topology');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2026.synthetic.retention',2026,'draft',1,'Synthetic source');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
      VALUES (2026,'configuring','2026.synthetic.retention','2026.synthetic.retention',1,
        '{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2026-09-30","personnelEvaluationOn":"2026-09-30"}');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
      VALUES ('${OPEN}','2026.synthetic.retention','A','7','Combat','Synthetic Engine','LT','Synthetic LT'),
        ('${CLOSED}','2026.synthetic.retention','D','7','Administration','Synthetic Training','LT','Synthetic Training LT'),
        ('synthetic-reviewed-captain','2026.synthetic.retention','A','7','Combat','Synthetic Ladder','CPT','Synthetic Captain');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
      VALUES ('2026.synthetic.retention','${OPEN}','2026.synthetic.retention','{"rank":["LT"],"credentials":[],"custom":[]}',
        '{"max":0,"items":[]}','["rank_seniority"]'),
        ('2026.synthetic.retention','synthetic-reviewed-captain','2026.synthetic.retention','{"rank":["CPT"],"credentials":[],"custom":[]}',
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
    vi.useRealTimers();
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
        {
          id: 'synthetic-captains',
          label: 'Synthetic Captain coverage',
          order: 2,
          memberIds: [94003],
          opportunityPositionIds: ['synthetic-reviewed-captain'],
          kind: 'CAPTAIN',
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
        stageOrder: ['synthetic-lieutenants', 'synthetic-captains'],
        requiredTopologyPositionIds: [OPEN, 'synthetic-reviewed-captain'],
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
    content.sourceDecisions.push({
      issueId: '2026-latest-substantive-ranks',
      title: 'Synthetic source provenance',
      question: 'Reviewed sources?',
      area: 'annual-policy',
      status: 'RESOLVED',
      decision: 'Synthetic reviewed source identity',
      sourceRef: `${LATEST_2026_MASTER_HASH}; ${LATEST_2026_ANNUAL_HASH}`,
      effectiveOn: '2026-09-30',
    });
    for (let prior = 1; prior < 10; prior++) {
      content.notes.bid = `Synthetic historical version ${prior}`;
      await saved(content);
    }
    content.notes.bid = 'Synthetic original approved source';
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
      capturedAtMs: Date.now(),
      mode: 'mock',
    });
    deepStrictEqual(h.sqlite.serialize(), before);
    return result;
  }

  function seedReviewedImport(reviewed = 3884) {
    const acceptedAt = Date.now() - 1000;
    h.sqlite
      .prepare(`INSERT INTO targetsolutions_imports
      (id,filename,observed_on,source_row_count,unique_row_count,coverage_json,status,created_by,created_at)
      VALUES ('synthetic-v5','synthetic.xlsx','2026-10-01',3884,3884,?,'reviewed','synthetic-editor',?)`)
      .run(
        JSON.stringify({
          sourceReceipt: {
            workbook_hash: OCTOBER1_2026_ANNUAL_HASH,
            source_revision: 5,
            selected_sheet: '2026_BID_Credentials_Version_5_',
            row_count: 3884,
            unique_employee_count: 230,
          },
        }),
        acceptedAt,
      );
    h.sqlite
      .prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<3884)
      INSERT INTO targetsolutions_rows (id,import_id,row_number,source_json,classification,reviewed_at,applied_at)
      SELECT 'synthetic-v5-row-'||i,'synthetic-v5',i,'{}','REFERENCE_ONLY',?,CASE WHEN i<=? THEN ? ELSE NULL END FROM n`)
      .run(acceptedAt, reviewed, acceptedAt);
  }

  function seedHold() {
    h.sqlite.exec(`INSERT INTO targetsolutions_imports
      (id,filename,observed_on,source_row_count,unique_row_count,coverage_json,status,created_by,created_at)
      VALUES ('synthetic-held','held.xlsx','2026-09-30',1,1,'{}','reviewed','synthetic-editor',1);
      INSERT INTO targetsolutions_rows
      (id,import_id,row_number,source_json,member_id,credential_id,classification,before_json,reviewed_at,applied_at)
      VALUES ('synthetic-held-row','synthetic-held',1,'{}',${OTHER},94001,'CONFLICT',
      '{"reviewHold":{"status":"NEEDS ADMIN EVIDENCE","reviewedAt":1}}',1,1);`);
  }

  async function fixture(reviewed = 3884) {
    seedHold();
    const historical = await sourceFixture();
    expect(historical.baseline.row.version_number).toBe(11);
    const retained = await saved(historical.receipt.content);
    expect(retained.row.version_number).toBe(12);
    vi.setSystemTime(Date.parse('2026-10-01T23:00:00Z'));
    seedReviewedImport(reviewed);
    return { ...historical, retained };
  }

  async function capture(key = 'synthetic-reviewed-update') {
    const preview = await previewReviewedBidEvidenceUpdate(h.env.DB, 'false');
    if (!preview.ok) throw new Error(JSON.stringify(preview));
    const request = {
      expected: preview.expected,
      reason: 'Apply the separately reviewed October source ledger',
    };
    const input = { key, actorSubject: String(OTHER), actorId: OTHER, request };
    const result = await captureReviewedBidEvidenceUpdate(h.env.DB, input, 'false');
    return { result, preview, input };
  }

  async function request(
    path: string,
    body?: unknown,
    options: { role?: 'admin' | 'member'; fresh?: boolean; auth?: boolean; key?: string } = {},
  ) {
    const jwt = await signJwt(
      {
        sub: OTHER,
        emp: '17836',
        role: options.role ?? 'admin',
        rank: 'LT',
        first_name: 'Synthetic',
        last_name: 'Reviewer',
        fresh_auth_at: Math.floor(Date.now() / 1000) - (options.fresh === false ? 86400 : 0),
      },
      h.env.JWT_SIGNING_KEY,
    );
    return app.fetch(
      new Request(`http://x/api/admin/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.auth === false ? {} : { Authorization: `Bearer ${jwt}` }),
          ...(options.key ? { 'Idempotency-Key': options.key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      h.env,
    );
  }

  it('preserves original V11 evidence while explicit capture, readback and ordinary Save prepare a new Mock', async () => {
    const f = await fixture();
    const old = await prepare(f.baseline);
    const head = await loadBidDefinitionHead(h.env.DB, 2026);
    const { result, preview, input } = await capture();
    expect(preview).toMatchObject({
      ready: true,
      counts: { members: 4, pendingQualificationHolds: 1 },
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.replayed).toBe(false);
    const update = result.response.update;
    expect(await loadBidDefinitionHead(h.env.DB, 2026)).toEqual(head);
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM bid_sessions').get()).toEqual({ n: 0 });
    expect(
      await loadReviewedBidEvidenceUpdate(getDb(h.env.DB), 2026, update.freezeId),
    ).toMatchObject({ response: result.response });
    expect((await loadBidEvidenceFreeze(getDb(h.env.DB), 2026))?.row.id).toBe(f.row.id);
    expect(
      (await loadPinnedBidEvidenceFreeze(getDb(h.env.DB), 2026, update.freezeId))?.row.id,
    ).toBe(update.freezeId);
    expect(update.eligibilityDates).toEqual({
      credentialEvaluationOn: '2026-09-30',
      personnelEvaluationOn: '2026-09-30',
    });
    expect(update.freezePin.reviewedUpdate?.originalFreezeId).toBe(f.row.id);
    expect(update.sourceDecisions[0]?.sourceRef).toContain(OCTOBER1_2026_ANNUAL_HASH);
    const next = structuredClone(f.retained.content);
    if (next.settings?.v !== 3) throw new Error('Expected V3 fixture');
    next.settings.evidenceFreeze = update.freezePin;
    next.sourceDecisions = update.sourceDecisions;
    const successor = await saved(next);
    const prepared = await prepare(successor);
    if (!prepared.ok) throw new Error(JSON.stringify(prepared));
    expect(
      await prepareBidDefinitionRun(h.env.DB, {
        year: 2026,
        versionId: successor.row.id,
        versionSha256: successor.sha256,
        bidSessionId: 'synthetic-live-hold-check',
        capturedAtMs: Date.now(),
        mode: 'live',
      }),
    ).toMatchObject({ ok: false, code: 'credential_import_dispute_requires_review' });
    expect(prepared.snapshot.members.find((member) => member.memberId === HOLDER)).toMatchObject({
      pool: 'EXCLUDED',
      exclusionReason: 'ADMIN_ASSIGNED_NON_BIDDABLE',
    });
    expect(
      prepared.snapshot.members.find((member) => member.memberId === OTHER)?.credentialNames,
    ).toEqual([]);
    expect(
      prepared.snapshot.settings.v === 3 &&
        prepared.snapshot.settings.livePolicy.stages[0]?.memberIds,
    ).toEqual([OTHER]);
    const historical = await prepare(f.baseline);
    if (!historical.ok || !old.ok) throw new Error('Original pinned version must remain valid');
    expect(historical.snapshotJson).toBe(old.snapshotJson);
    expect(historical.pins).toEqual(old.pins);
    expect(h.sqlite.prepare('SELECT * FROM bid_evidence_freezes WHERE id=?').get(f.row.id)).toEqual(
      f.row,
    );
    expect(await captureReviewedBidEvidenceUpdate(h.env.DB, input, 'false')).toMatchObject({
      ok: true,
      replayed: true,
      response: result.response,
    });
    const readback = await request(`bid/2026/evidence-updates/${update.freezeId}`);
    expect(readback.status, await readback.clone().text()).toBe(200);
    expect(await readback.json()).toEqual({ ok: true, ...result.response });
    const mockPreviewResponse = await request('bid/2026/preview', {
      kind: 'mock',
      versionId: successor.row.id,
      versionSha256: successor.sha256,
    });
    expect(mockPreviewResponse.status, await mockPreviewResponse.clone().text()).toBe(200);
    const mockPreview = (await mockPreviewResponse.json()) as {
      contextSha256: string;
      runtimeSourceToken: string;
    };
    const createdResponse = await request(
      'bid/2026/mock-sessions',
      {
        versionId: successor.row.id,
        versionSha256: successor.sha256,
        expectedContextSha256: mockPreview.contextSha256,
        expectedSourceToken: mockPreview.runtimeSourceToken,
      },
      { key: 'synthetic-reviewed-update-mock' },
    );
    expect(createdResponse.status, await createdResponse.clone().text()).toBe(201);
    const created = (await createdResponse.json()) as { id: string };
    const start = await request(`bid-session/${created.id}/start`, {});
    expect(start.status, await start.clone().text()).toBe(200);
    expect(
      h.sqlite
        .prepare('SELECT current_phase,current_bidder_id FROM bid_sessions WHERE id=?')
        .get(created.id),
    ).toEqual({ current_phase: 'position_bid', current_bidder_id: OTHER });
  });

  it('reports an incompletely reviewed V5 import without capturing or changing any head', async () => {
    await fixture(3883);
    const before = h.sqlite.serialize();
    const { result, preview } = await capture();
    expect(preview).toMatchObject({
      ready: false,
      blockers: ['latest_2026_credential_revision_review_required'],
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'latest_2026_credential_revision_review_required',
    });
    deepStrictEqual(h.sqlite.serialize(), before);
  });

  it.each(['real', 'writeback'] as const)(
    'rejects capture with %s enabled without replacing an existing freeze',
    async (kind) => {
      await fixture();
      if (kind === 'real')
        h.sqlite.exec(`INSERT INTO bid_sessions (id,bid_year,started_at,current_phase,is_mock)
      VALUES ('synthetic-active-real',2026,1,'config',0)`);
      const flag = kind === 'writeback' ? 'true' : 'false';
      const before = h.sqlite.serialize();
      const preview = await previewReviewedBidEvidenceUpdate(h.env.DB, flag);
      expect(preview).toMatchObject({
        ok: true,
        ready: false,
        blockers: [`evidence_update_${kind === 'real' ? 'real_active' : 'writeback_enabled'}`],
      });
      if (!preview.ok) throw new Error('Missing rejected preview');
      expect(
        await captureReviewedBidEvidenceUpdate(
          h.env.DB,
          {
            key: 'synthetic-disabled',
            actorSubject: String(OTHER),
            actorId: OTHER,
            request: { expected: preview.expected, reason: 'Synthetic blocked observation' },
          },
          flag,
        ),
      ).toMatchObject({ ok: false });
      deepStrictEqual(h.sqlite.serialize(), before);
    },
  );

  it('rejects stale import generation and atomically rolls back a source race or injected later statement failure', async () => {
    await fixture();
    const preview = await previewReviewedBidEvidenceUpdate(h.env.DB, 'false');
    if (!preview.ok) throw new Error('Missing preview');
    const input = {
      key: 'synthetic-stale',
      actorSubject: String(OTHER),
      actorId: OTHER,
      request: { expected: preview.expected, reason: 'Synthetic source race regression' },
    };
    h.sqlite.exec(`INSERT INTO targetsolutions_imports
      (id,filename,observed_on,source_row_count,unique_row_count,coverage_json,status,created_by,created_at)
      VALUES ('synthetic-racing','race.xlsx','2026-10-01',0,0,'{}','staged','synthetic-editor',1)`);
    expect(await captureReviewedBidEvidenceUpdate(h.env.DB, input, 'false')).toMatchObject({
      ok: false,
      error: 'evidence_update_source_changed',
      recorded: false,
    });
    const current = await previewReviewedBidEvidenceUpdate(h.env.DB, 'false');
    if (!current.ok) throw new Error('Missing fresh preview');
    input.request.expected = current.expected;
    const before = h.sqlite.serialize();
    h.failNextBatchAt(2);
    expect(await captureReviewedBidEvidenceUpdate(h.env.DB, input, 'false')).toMatchObject({
      ok: false,
      error: 'evidence_update_capture_failed',
    });
    deepStrictEqual(h.sqlite.serialize(), before);
    const batch = h.env.DB.batch.bind(h.env.DB);
    const spy = vi.spyOn(h.env.DB, 'batch').mockImplementationOnce(async (statements) => {
      h.sqlite.prepare('UPDATE members SET updated_at=updated_at+1 WHERE id=?').run(OTHER);
      return batch(statements);
    });
    expect(await captureReviewedBidEvidenceUpdate(h.env.DB, input, 'false')).toMatchObject({
      ok: false,
      error: 'evidence_update_source_changed',
      recorded: false,
    });
    spy.mockRestore();
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM bid_evidence_reviewed_updates').get()).toEqual({
      n: 0,
    });
    expect(
      h.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM admin_configuration_receipts WHERE operation='bid-evidence-reviewed-update'",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(
      h.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM audit_log WHERE target_kind='bid_evidence_reviewed_update'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it('binds replay to actor/request, enforces immutable storage and rejects changed source decisions or forged new pins', async () => {
    const f = await fixture();
    const { result, input } = await capture();
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(
      await captureReviewedBidEvidenceUpdate(
        h.env.DB,
        { ...input, request: { ...input.request, reason: 'Different request' } },
        'false',
      ),
    ).toMatchObject({ ok: false, error: 'idempotency_key_reused' });
    expect(
      await captureReviewedBidEvidenceUpdate(
        h.env.DB,
        { ...input, actorSubject: 'another-actor' },
        'false',
      ),
    ).toMatchObject({ ok: false, error: 'idempotency_key_reused' });
    for (const operation of [
      "UPDATE bid_evidence_reviewed_updates SET reason='Altered reason' WHERE id=?",
      'DELETE FROM bid_evidence_reviewed_updates WHERE id=?',
      'INSERT OR REPLACE INTO bid_evidence_reviewed_updates SELECT * FROM bid_evidence_reviewed_updates WHERE id=?',
    ])
      expect(() => h.sqlite.prepare(operation).run(result.response.update.freezeId)).toThrow(
        /immutable/,
      );
    for (const kind of ['decision', 'hash', 'original'] as const) {
      const content = structuredClone(f.retained.content);
      if (content.settings?.v !== 3) throw new Error('Missing settings');
      const pin = structuredClone(result.response.update.freezePin);
      content.settings.evidenceFreeze = pin;
      content.sourceDecisions = structuredClone(result.response.update.sourceDecisions);
      const decision = content.sourceDecisions[0];
      const provenance = pin.reviewedUpdate;
      if (!decision || !provenance) throw new Error('Missing reviewed source fixture');
      if (kind === 'decision') decision.decision = 'Changed unrelated policy authority';
      if (kind === 'hash') pin.evaluationSha256 = 'f'.repeat(64);
      if (kind === 'original') provenance.originalFreezeId = 'forged-original';
      const version = await saved(content);
      expect(await prepare(version)).toMatchObject({
        ok: false,
        code: 'bid_evidence_freeze_integrity_failed',
      });
    }
  });

  it('requires an authenticated admin and fresh step-up for capture and never exposes private raw documents', async () => {
    await fixture();
    const { preview, input } = await capture('synthetic-route-first');
    for (const options of [{ auth: false }, { role: 'member' as const }, { fresh: false }]) {
      const response = await request('bid/2026/evidence-updates', input.request, {
        ...options,
        key: 'synthetic-rejected-auth',
      });
      expect([401, 403]).toContain(response.status);
    }
    const response = await request('bid/2026/evidence-updates', input.request, {
      key: 'synthetic-route-capture',
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(
      /personnel_source_json|credential_source_json|qualificationEventRows|memberRows|provenance_json|parameters/,
    );
    const publicPreview = await request('bid/2026/evidence-updates/preview');
    expect(publicPreview.status).toBe(200);
    expect(publicPreview.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await publicPreview.json()).toMatchObject({ expected: preview.expected });
  });

  it.each([
    ['original-import', 'evidence_source_after_cutoff'],
    ['future-import', 'evidence_source_after_observation'],
    ['earlier-observation', 'reviewed_evidence_observation_invalid'],
    ['snapshot-asOf', 'evidence_snapshot_observation_mismatch'],
    ['snapshot-captured', 'evidence_snapshot_observation_mismatch'],
    ['mixed-derivation', 'reviewed_evidence_observation_invalid'],
    ['altered-cutoff', 'evidence_freeze_cutoff_mismatch'],
  ])('keeps the ordinary draft boundary strict for %s', async (kind, code) => {
    const f = await fixture();
    const { result } = await capture();
    if (!result.ok) throw new Error(JSON.stringify(result));
    const content = structuredClone(f.retained.content);
    if (content.settings?.v !== 3) throw new Error('Missing V3 fixture');
    const previousDerivation = content.settings.evidenceFreeze?.derivation;
    const pin = structuredClone(result.response.update.freezePin);
    content.settings.evidenceFreeze = pin;
    content.sourceDecisions = result.response.update.sourceDecisions;
    expect(canonicalBidDefinition(content).ok).toBe(true);
    if (kind === 'original-import') {
      pin.reviewedUpdate = undefined;
      pin.personnelSnapshot.asOfAt = pin.evidenceCutoffAt;
      pin.credentialSnapshot.asOfAt = pin.evidenceCutoffAt;
    }
    if (kind === 'future-import') {
      const source = pin.sourceImports[0];
      if (!source) throw new Error('Missing sealed source');
      source.acceptedAt = '2027-01-01T00:00:00Z';
    }
    if (kind === 'earlier-observation') {
      if (!pin.reviewedUpdate) throw new Error('Missing observation');
      pin.reviewedUpdate.observedAsOfAt = '2026-09-29T00:00:00Z';
    }
    if (kind === 'snapshot-asOf') pin.personnelSnapshot.asOfAt = pin.evidenceCutoffAt;
    if (kind === 'snapshot-captured') pin.credentialSnapshot.capturedAt = pin.evidenceCutoffAt;
    if (kind === 'mixed-derivation') {
      if (!previousDerivation) throw new Error('Missing existing retention proof');
      pin.derivation = previousDerivation;
    }
    if (kind === 'altered-cutoff') pin.evidenceCutoffAt = '2026-10-01T17:00:00-04:00';
    const rejected = canonicalBidDefinition(content);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error('Invalid observation accepted');
    expect(rejected.issues.some((issue) => issue.code === code)).toBe(true);
  });

  it('rejects a Real session that appears at the conditional commit boundary without a partial audit or receipt', async () => {
    await fixture();
    const preview = await previewReviewedBidEvidenceUpdate(h.env.DB, 'false');
    if (!preview.ok) throw new Error('Missing ready preview');
    const batch = h.env.DB.batch.bind(h.env.DB);
    const spy = vi.spyOn(h.env.DB, 'batch').mockImplementationOnce(async (statements) => {
      h.sqlite.exec(`INSERT INTO bid_sessions (id,bid_year,started_at,current_phase,is_mock)
        VALUES ('synthetic-racing-real',2026,1,'config',0)`);
      return batch(statements);
    });
    expect(
      await captureReviewedBidEvidenceUpdate(
        h.env.DB,
        {
          key: 'synthetic-real-race',
          actorSubject: String(OTHER),
          actorId: OTHER,
          request: {
            expected: preview.expected,
            reason: 'Synthetic simultaneous Real start guard',
          },
        },
        'false',
      ),
    ).toMatchObject({ ok: false });
    spy.mockRestore();
    for (const query of [
      'SELECT COUNT(*) n FROM bid_evidence_reviewed_updates',
      "SELECT COUNT(*) n FROM admin_configuration_receipts WHERE operation='bid-evidence-reviewed-update'",
      "SELECT COUNT(*) n FROM audit_log WHERE target_kind='bid_evidence_reviewed_update'",
    ])
      expect(h.sqlite.prepare(query).get()).toEqual({ n: 0 });
  });

  it('preserves an uncertain committed request when readback fails and replays its exact receipt after recovery', async () => {
    await fixture();
    const preview = await previewReviewedBidEvidenceUpdate(h.env.DB, 'false');
    if (!preview.ok) throw new Error('Missing ready preview');
    const input = {
      key: 'synthetic-uncertain-commit',
      actorSubject: String(OTHER),
      actorId: OTHER,
      request: { expected: preview.expected, reason: 'Synthetic post-commit readback failure' },
    };
    const prepareStatement = h.env.DB.prepare.bind(h.env.DB);
    const executeBatch = h.env.DB.batch.bind(h.env.DB);
    let committed = false;
    const batch = vi.spyOn(h.env.DB, 'batch').mockImplementationOnce(async (statements) => {
      const result = await executeBatch(statements);
      committed = true;
      h.sqlite.prepare('UPDATE members SET updated_at=updated_at+1 WHERE id=?').run(OTHER);
      return result;
    });
    const readback = vi.spyOn(h.env.DB, 'prepare').mockImplementation((query) => {
      if (committed && /^SELECT \* FROM bid_evidence_reviewed_updates/i.test(query.trim()))
        throw new Error('Synthetic readback unavailable after committed transaction');
      return prepareStatement(query);
    });
    const response = await request('bid/2026/evidence-updates', input.request, { key: input.key });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: 'evidence_update_capture_failed' });
    readback.mockRestore();
    batch.mockRestore();
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM bid_evidence_reviewed_updates').get()).toEqual({
      n: 1,
    });
    expect(await captureReviewedBidEvidenceUpdate(h.env.DB, input, 'false')).toMatchObject({
      ok: true,
      replayed: true,
    });
  });

  it('detects offline receipt corruption rather than trusting reconstructed public counts', async () => {
    await fixture();
    const { result, input } = await capture();
    if (!result.ok) throw new Error(JSON.stringify(result));
    // Fault injection is confined to the synthetic DB; production triggers
    // prohibit this write. The reader still detects damaged stored evidence.
    const triggers = h.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='admin_configuration_receipts'",
      )
      .all() as { name: string }[];
    for (const trigger of triggers)
      h.sqlite.exec(`DROP TRIGGER "${trigger.name.replaceAll('"', '""')}"`);
    const damaged = structuredClone(result.response);
    damaged.update.counts.pendingQualificationHolds = 0;
    h.sqlite
      .prepare('UPDATE admin_configuration_receipts SET response_json=? WHERE idempotency_key=?')
      .run(JSON.stringify(damaged), input.key);
    await expect(
      loadReviewedBidEvidenceUpdate(getDb(h.env.DB), 2026, result.response.update.freezeId),
    ).rejects.toThrow('bid_evidence_reviewed_update_receipt_invalid');
    const readback = await request(`bid/2026/evidence-updates/${result.response.update.freezeId}`);
    expect(readback.status).toBe(409);
    expect(await readback.json()).toEqual({
      error: 'bid_evidence_reviewed_update_integrity_failed',
    });
  });
});
