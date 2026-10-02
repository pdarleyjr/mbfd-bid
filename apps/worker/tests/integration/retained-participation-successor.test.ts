import { deepStrictEqual } from 'node:assert';
import {
  type BidDefinitionContent,
  BidDispositionSchema,
  BidEvidenceFreezeSchema,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/index.js';
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
