import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  type BidDefinitionContent,
  BidDispositionSchema,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/db/index.js';
import {
  bidDefinitionContextHash,
  snapshotMatchesBidDefinition,
} from '../../src/lib/bid-definition-context.js';
import { validateBidDefinitionSnapshotPin } from '../../src/lib/bid-definition-pin.js';
import { prepareBidDefinitionRun } from '../../src/lib/bid-definition-run.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import {
  loadBidSessionPolicySnapshot,
  loadFrozenSessionBidPolicy,
  prepareBidSessionPolicySnapshot,
} from '../../src/lib/bid-policy.js';
import { evaluateLiveBidReadiness } from '../../src/lib/live-bid-readiness.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

type Version = Extract<Awaited<ReturnType<typeof loadBidDefinitionVersion>>, { ok: true }>;
type RunInput = Parameters<typeof prepareBidDefinitionRun>[1];
const CAPTURED_AT = Date.parse('2027-02-10T14:23:45.678Z');
const SESSION = 'synthetic-prepared-session';
const SOURCE_HASH = 'a'.repeat(64);

function syntheticLivePolicy() {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-read-only-run-policy',
    stages: [
      {
        id: 'first',
        label: 'Synthetic stage',
        order: 0,
        memberIds: [10001],
        opportunityPositionIds: ['synthetic-run-seat'],
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
  });
}

describe('read-only preparation of an explicit saved Bid version', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,
        employment_status,employment_status_effective_on,created_at,updated_at)
      VALUES (10001,'synthetic-run-editor','Synthetic','Editor','FF','FF',1,0,'active','2020-01-01',1,1),
        (10002,'synthetic-run-unknown','Synthetic','Unknown','FF','FF',2,0,'unknown',NULL,1,1),
        (10003,'synthetic-run-retiring','Synthetic','Retiring','FF','FF',3,0,'active','2020-01-01',1,1);
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic run topology');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',4,'Synthetic run source');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',3,'{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-01","personnelEvaluationOn":"2027-01-01"}');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('synthetic-run-seat','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic firefighter');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','synthetic-run-seat','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}',
          '{"max":0,"items":[]}','["rsc_seniority"]');
      INSERT INTO credentials (id,name) VALUES (7001,'Synthetic January credential'),(7002,'Synthetic February credential');
      INSERT INTO member_credentials (member_id,credential_id,start_date,expiration_date)
        VALUES (10001,7001,'2026-01-01','2027-01-15'),(10001,7002,'2027-02-01',NULL);
      INSERT INTO personnel_lifecycle_events
        (id,member_id,staffing_position_id,member_assignment_id,kind,effective_on,employment_status_before,
         employment_status_after,rank_before,rank_after,separation_type,reason,origin,actor_subject,
         idempotency_key,before_state,after_state,created_at)
        VALUES ('synthetic-run-retirement',10003,NULL,NULL,'RETIREMENT','2027-01-15','active','retired','FF','FF',
          'RETIREMENT','Synthetic dated retirement evidence','ADMIN','synthetic-editor','synthetic-run-retirement',
          '{"employmentStatus":"active","employmentStatusEffectiveOn":"2020-01-01","separationType":null,"rank":"FF"}',
          '{"employmentStatus":"retired","separationType":"RETIREMENT","rank":"FF"}',1);
    `);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  function acceptedBaseline() {
    // Actual import/mapping/observation/assignment/baseline relationships, all
    // synthetic. No personnel correction is supplied for the unknown member.
    h.sqlite.exec(`
      INSERT INTO staffing_positions
        (id,stable_slot_key,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at)
        VALUES ('synthetic-run-staffing','SYNTHETIC/A/7/FF','A','7','Synthetic Engine','Synthetic firefighter','FF',
          '2027-01-01','approved',1,1);
      INSERT INTO staffing_position_source_mappings
        (id,staffing_position_id,source_system,source_locator,source_signature,source_version,source_hash,effective_from,created_at)
        VALUES ('synthetic-run-mapping','synthetic-run-staffing','telestaff',
          '{"v":1,"shift":"A","division":"Combat","station":"7","unit":"Synthetic Engine","position":"Synthetic firefighter"}',
          '${SOURCE_HASH}','synthetic-v1','${SOURCE_HASH}','2027-01-01',1);
      INSERT INTO assignment_imports
        (id,source_system,source_version,source_hash,source_format,parser_version,source_kind,status,input_row_count,
         normalized_data_row_count,unique_employee_count,report_row_count,structural_row_count,source_snapshot_as_of,created_at)
        VALUES ('synthetic-run-import','telestaff','synthetic-v1','${SOURCE_HASH}',
          'TELSTAFF_ASSIGNMENTS_HTML_V1','telestaff-assignments-html@1','official','staged',1,1,1,1,0,'2027-01-01',1);
      INSERT INTO assignment_import_rows
        (id,import_id,source_row_number,row_fingerprint,member_reference_hmac,resolved_member_id,
         staffing_position_source_mapping_id,normalized_source_topology,disposition,reconciliation_classification,review_status,created_at)
        VALUES ('synthetic-run-row','synthetic-run-import',1,'${'b'.repeat(64)}','${'c'.repeat(64)}',10002,
          'synthetic-run-mapping','{"v":1,"shift":"A","division":"Combat","station":"7","unit":"Synthetic Engine","position":"Synthetic firefighter"}',
          'unchanged','UNCHANGED','not_required',1);
      UPDATE assignment_imports SET status='reviewed' WHERE id='synthetic-run-import';
      UPDATE assignment_imports SET status='approved',approved_at=1,approved_by_member_id=10001 WHERE id='synthetic-run-import';
      UPDATE assignment_imports SET status='committed',committed_at=1 WHERE id='synthetic-run-import';
      INSERT INTO assignment_observations
        (id,assignment_import_id,assignment_import_row_id,member_id,staffing_position_id,
         staffing_position_source_mapping_id,normalized_source_topology,observed_at,created_at)
        VALUES ('synthetic-run-observation','synthetic-run-import','synthetic-run-row',10002,'synthetic-run-staffing',
          'synthetic-run-mapping','{"v":1,"shift":"A","division":"Combat","station":"7","unit":"Synthetic Engine","position":"Synthetic firefighter"}',1,1);
      INSERT INTO member_assignments
        (id,member_id,staffing_position_id,origin_type,origin_ref,source_observation_id,status,effective_from,effective_to,created_at,updated_at)
        VALUES ('synthetic-run-assignment',10002,'synthetic-run-staffing','TELESTAFF_IMPORT','synthetic-run-import',
          'synthetic-run-observation','active','2027-01-01','2027-01-31',1,1);
      INSERT INTO bid_year_staffing_baselines
        (id,bid_year,assignment_import_id,status,accepted_at,accepted_by_member_id,acceptance_reason,created_at)
        VALUES ('synthetic-run-baseline',2027,'synthetic-run-import','accepted',1,10001,
          'Synthetic accepted baseline for Mock-only participation',1);
    `);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  }

  function decision(status: 'OPEN' | 'RESOLVED', revision: number) {
    h.sqlite
      .prepare(`INSERT INTO bid_source_decisions
        (bid_year,issue_id,revision,title,question,area,status,decision,source_ref,effective_on,actor_subject,created_at)
        VALUES (2027,'synthetic-run-issue',?,'Synthetic policy question','Which evidence applies?','annual-policy',?,?,
          'synthetic:decision','2027-01-01','synthetic-editor',?)`)
      .run(
        revision,
        status,
        status === 'RESOLVED' ? 'Synthetic explicit resolution' : '',
        revision,
      );
  }

  async function savedVersion(change?: (content: BidDefinitionContent) => void): Promise<Version> {
    const captured = await captureBidDefinitionSource(h.env.DB, 2027);
    if (!captured.ok) throw new Error(JSON.stringify(captured));
    const content = structuredClone(captured.content);
    change?.(content);
    const saved = await saveBidDefinition(h.env.DB, {
      year: 2027,
      key: 'synthetic-run-save',
      actorSubject: 'synthetic-editor',
      actorId: 10001,
      expected: { kind: 'legacy', sourceToken: captured.sourceToken },
      reason: 'Synthetic explicit version for preparation',
      intent: { operation: 'save', content },
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const loaded = await loadBidDefinitionVersion(h.env.DB, 2027, String(saved.response.versionId));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    return loaded;
  }

  function input(version: Version, overrides: Partial<RunInput> = {}): RunInput {
    return {
      year: 2027,
      versionId: version.row.id,
      versionSha256: version.sha256,
      bidSessionId: SESSION,
      capturedAtMs: CAPTURED_AT,
      mode: 'mock',
      ...overrides,
    };
  }

  async function readOnly<T>(operation: () => Promise<T>): Promise<T> {
    const bytes = h.sqlite.serialize();
    const value = await operation();
    deepStrictEqual(h.sqlite.serialize(), bytes);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    return value;
  }

  async function prepared(version: Version, overrides: Partial<RunInput> = {}) {
    const result = await readOnly(() =>
      prepareBidDefinitionRun(h.env.DB, input(version, overrides)),
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result;
  }

  it('builds dated Mock material and exact pins without changing the year or any database bytes', async () => {
    const version = await savedVersion();
    const designation = h.sqlite.prepare('SELECT * FROM bid_years').all();
    const result = await prepared(version);
    expect(result.snapshot.members.find((member) => member.memberId === 10001)).toMatchObject({
      pool: 'FF',
      credentialNames: ['Synthetic January credential'],
    });
    expect(result.snapshot.members.find((member) => member.memberId === 10003)).toMatchObject({
      pool: 'FF',
    });
    expect(result.snapshot.members.find((member) => member.memberId === 10002)).toMatchObject({
      pool: 'EXCLUDED',
      exclusionReason: 'MEMBER_EMPLOYMENT_UNCONFIRMED',
    });
    expect(result.snapshot).not.toHaveProperty('staffingBaseline');
    expect(result.snapshot.settings).toMatchObject({
      personnelEvaluationOn: '2027-01-01',
      credentialEvaluationOn: '2027-01-01',
    });
    expect(result.snapshot.bidDefinition).toEqual({
      v: 1,
      bidSessionId: SESSION,
      bidYear: 2027,
      versionId: version.row.id,
      versionSha256: version.sha256,
      contextSha256: result.pins.contextSha256,
    });
    expect(JSON.parse(result.snapshotJson)).toEqual(result.snapshot);
    expect(result.pins.snapshotSha256).toBe(
      createHash('sha256').update(result.snapshotJson, 'utf8').digest('hex'),
    );
    expect(result.pins.contextSha256).toBe(bidDefinitionContextHash(result.snapshot));
    expect(snapshotMatchesBidDefinition(result.snapshot, version)).toBe(true);
    expect(result.coverage.valid).toBe(true);
    expect(
      validateBidDefinitionSnapshotPin({
        row: {
          ...result.pins,
          bidSessionId: SESSION,
          bidYear: 2027,
          ruleBookVersion: version.row.rule_book_version,
          positionTemplateVersion: version.row.position_template_version,
          ruleBookRevision: version.row.rule_book_revision,
          capturedAtMs: CAPTURED_AT,
          snapshotJson: result.snapshotJson,
        },
        expectedBidSessionId: SESSION,
        version: {
          id: version.row.id,
          bidYear: 2027,
          contentSha256: version.sha256,
          ruleBookVersion: version.row.rule_book_version,
          positionTemplateVersion: version.row.position_template_version,
          ruleBookRevision: version.row.rule_book_revision,
        },
        expectedContextSha256: result.pins.contextSha256,
      }),
    ).toMatchObject({ ok: true, kind: 'pinned', contextDigestChecked: true });
    expect(
      h.sqlite
        .prepare(`SELECT ${result.sourceGuard.sql} AS matched`)
        .get(...result.sourceGuard.parameters),
    ).toEqual({ matched: 1 });
    expect(h.sqlite.prepare('SELECT * FROM bid_years').all()).toEqual(designation);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_sessions').get()).toEqual({ n: 0 });
    expect(
      h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_session_policy_snapshots').get(),
    ).toEqual({ n: 0 });
  });

  it('preserves accepted-baseline Mock participation without correcting unknown employment', async () => {
    acceptedBaseline();
    const version = await savedVersion();
    const result = await prepared(version);
    expect(result.snapshot.members.find((member) => member.memberId === 10002)).toMatchObject({
      pool: 'FF',
      exclusionReason: null,
      mockParticipationEvidence: 'ACCEPTED_STAFFING_BASELINE',
    });
    expect(result.snapshot.staffingBaseline).toMatchObject({
      baselineAcceptanceId: 'synthetic-run-baseline',
      importId: 'synthetic-run-import',
      sourceHash: SOURCE_HASH,
    });
    expect(
      h.sqlite
        .prepare(
          'SELECT employment_status,employment_status_effective_on FROM members WHERE id=10002',
        )
        .get(),
    ).toEqual({ employment_status: 'unknown', employment_status_effective_on: null });
  });

  it('uses an explicit older version and its dated context after a different version becomes current', async () => {
    acceptedBaseline();
    const version = await savedVersion();
    const initial = await prepared(version);
    if (version.content.settings?.v !== 2) throw new Error('Synthetic V2 settings required');
    const next = await saveBidDefinition(h.env.DB, {
      year: 2027,
      key: 'synthetic-run-successor',
      actorSubject: 'synthetic-editor',
      actorId: 10001,
      expected: { kind: 'version', versionId: version.row.id, revision: 1, sha256: version.sha256 },
      reason: 'Synthetic next version uses later evidence dates',
      intent: {
        operation: 'save',
        content: {
          ...version.content,
          settings: {
            ...version.content.settings,
            personnelEvaluationOn: '2027-02-01',
            credentialEvaluationOn: '2027-02-01',
            turnTimerSeconds: 240,
          },
        },
      },
    });
    if (!next.ok) throw new Error(JSON.stringify(next));
    const newVersion = await loadBidDefinitionVersion(
      h.env.DB,
      2027,
      String(next.response.versionId),
    );
    if (!newVersion.ok) throw new Error(JSON.stringify(newVersion));
    const original = await prepared(version, { capturedAtMs: CAPTURED_AT + 86_400_000 });
    const current = await prepared(newVersion);
    expect(original.snapshot.settings).toEqual(initial.snapshot.settings);
    expect(original.snapshot.members).toEqual(initial.snapshot.members);
    expect(original.pins.contextSha256).toBe(initial.pins.contextSha256);
    expect(original.pins.bidVersionId).toBe(version.row.id);
    expect(current.pins.contextSha256).not.toBe(original.pins.contextSha256);
    expect(current.snapshot.members.find((member) => member.memberId === 10001)).toMatchObject({
      credentialNames: ['Synthetic February credential'],
    });
    expect(current.snapshot.members.find((member) => member.memberId === 10002)).toMatchObject({
      pool: 'EXCLUDED',
      exclusionReason: 'MEMBER_EMPLOYMENT_UNCONFIRMED',
    });
    expect(current.snapshot.members.find((member) => member.memberId === 10002)).not.toHaveProperty(
      'mockParticipationEvidence',
    );
    expect(current.snapshot.members.find((member) => member.memberId === 10003)).toMatchObject({
      pool: 'EXCLUDED',
      exclusionReason: 'MEMBER_NOT_ACTIVE',
    });
  });

  it.each(['empty', 'resolved'] as const)(
    'uses the saved %s decision collection instead of a subsequently OPEN global decision',
    async (kind) => {
      if (kind === 'resolved') decision('RESOLVED', 1);
      const version = await savedVersion();
      decision('OPEN', kind === 'resolved' ? 2 : 1);
      await prepared(version);
      expect(
        await readOnly(() =>
          prepareBidSessionPolicySnapshot(getDb(h.env.DB), 2027, CAPTURED_AT, 'mock'),
        ),
      ).toMatchObject({ ok: false, code: 'policy_source_decision_required' });
    },
  );

  it('allows a saved Real-only OPEN question in Mock but blocks the exact version in Live', async () => {
    decision('OPEN', 1);
    const version = await savedVersion((content) => {
      if (content.settings?.v !== 2) throw new Error('Synthetic V2 settings required');
      content.settings = { ...content.settings, v: 3, livePolicy: syntheticLivePolicy() };
      content.sourceDecisions = content.sourceDecisions.map((source) => ({
        ...source,
        blockingClassification: 'BLOCKS_REAL_BID_ACTIVATION',
        affectedScopes: ['contact-policy'],
      }));
    });
    decision('RESOLVED', 2);
    expect(await readOnly(() => prepareBidDefinitionRun(h.env.DB, input(version)))).toMatchObject({
      ok: true,
    });
    expect(
      await readOnly(() => prepareBidDefinitionRun(h.env.DB, input(version, { mode: 'live' }))),
    ).toMatchObject({
      ok: false,
      code: 'policy_source_decision_required',
    });
    const legacy = await readOnly(() =>
      prepareBidSessionPolicySnapshot(getDb(h.env.DB), 2027, CAPTURED_AT, 'mock'),
    );
    expect(legacy.ok, JSON.stringify(legacy)).toBe(true);
  });

  it.each(['BLOCKS_APPLICATION_RELEASE', 'BLOCKS_FINAL_2026_CONFIGURATION'] as const)(
    'keeps a saved %s question blocked in Mock',
    async (blockingClassification) => {
      decision('OPEN', 1);
      const version = await savedVersion((content) => {
        content.sourceDecisions = content.sourceDecisions.map((source) => ({
          ...source,
          blockingClassification,
          affectedScopes: ['annual-policy'],
        }));
      });
      expect(await readOnly(() => prepareBidDefinitionRun(h.env.DB, input(version)))).toMatchObject(
        {
          ok: false,
          code: 'policy_source_decision_required',
        },
      );
    },
  );

  it('prepares a managed version with valid trimmed source decision bounds while preserving recorded whitespace', async () => {
    decision('RESOLVED', 1);
    const version = await savedVersion((content) => {
      content.sourceDecisions = content.sourceDecisions.map((source) => ({
        ...source,
        title: ' \tTitle\n ',
        question: `  ${'Q'.repeat(3000)}  `,
        decision: ' \tRule\n ',
        sourceRef: `  ${'S'.repeat(1000)}  `,
      }));
    });
    expect(version.content.sourceDecisions[0]).toMatchObject({
      title: ' \tTitle\n ',
      question: `  ${'Q'.repeat(3000)}  `,
      decision: ' \tRule\n ',
      sourceRef: `  ${'S'.repeat(1000)}  `,
    });
    const result = await prepared(version);
    expect(result.pins.bidVersionId).toBe(version.row.id);
    expect(result.pins.bidVersionSha256).toBe(version.sha256);
    expect(result.coverage.valid).toBe(true);
  });

  it('rejects a control race during evidence loading without leaving preparation writes', async () => {
    const version = await savedVersion();
    const originalPrepare = h.env.DB.prepare.bind(h.env.DB);
    let raced = false;
    let afterConcurrentWrite: Buffer | undefined;
    vi.spyOn(h.env.DB, 'prepare').mockImplementation((sql) => {
      if (!raced && /from\s+"?members"?/iu.test(sql)) {
        raced = true;
        h.sqlite.exec('UPDATE annual_source_revision SET revision=revision+1 WHERE id=1');
        afterConcurrentWrite = h.sqlite.serialize();
      }
      return originalPrepare(sql);
    });
    expect(await prepareBidDefinitionRun(h.env.DB, input(version))).toMatchObject({
      ok: false,
      code: 'bid_definition_source_changed',
    });
    expect(raced).toBe(true);
    deepStrictEqual(h.sqlite.serialize(), afterConcurrentWrite);
  });

  it('preserves raw policy whitespace while prepared evidence survives both real snapshot loaders', async () => {
    const policyText = '\n  Synthetic policy language.\n\nSecond synthetic paragraph.  \n';
    const version = await savedVersion((content) => {
      const policy = syntheticLivePolicy();
      content.settings = {
        v: 3,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2027-01-01',
        personnelEvaluationOn: '2027-01-01',
        livePolicy: policy,
      };
      content.policy = { policyText, executionPolicy: policy };
    });
    expect(version.content.policy?.policyText).toBe(policyText);
    const result = await prepared(version);
    expect(result.snapshot.annualPolicyEvidence?.policyText).toBe(policyText.trim());
    expect(snapshotMatchesBidDefinition(result.snapshot, version)).toBe(true);

    // Persist exactly the preparation result into the synthetic database, with
    // all FK and 0060 pin guards enabled. No body/hash fixture substitution.
    h.sqlite
      .prepare(`INSERT INTO bid_sessions
        (id,bid_year,started_at,current_phase,is_mock,turn_timer_seconds,expected_duration_days,config_json)
        VALUES (?,2027,?,'not_started',1,?,?,?)`)
      .run(
        SESSION,
        CAPTURED_AT,
        result.snapshot.settings.turnTimerSeconds,
        result.snapshot.settings.expectedDurationDays,
        JSON.stringify(result.snapshot.settings),
      );
    h.sqlite
      .prepare(`INSERT INTO bid_session_policy_snapshots
        (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at,
         bid_version_id,bid_version_sha256,snapshot_sha256,context_sha256)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(
        SESSION,
        version.row.rule_book_version,
        version.row.position_template_version,
        version.row.rule_book_revision,
        result.snapshotJson,
        CAPTURED_AT,
        result.pins.bidVersionId,
        result.pins.bidVersionSha256,
        result.pins.snapshotSha256,
        result.pins.contextSha256,
      );
    expect(await readOnly(() => loadBidSessionPolicySnapshot(getDb(h.env.DB), SESSION))).toEqual({
      snapshot: result.snapshot,
      error: null,
    });
    expect(
      await readOnly(() => loadFrozenSessionBidPolicy(getDb(h.env.DB), SESSION)),
    ).toMatchObject({ ok: true, snapshot: result.snapshot, coverage: { valid: true } });
    const reloaded = await readOnly(() => loadBidDefinitionVersion(h.env.DB, 2027, version.row.id));
    expect(reloaded).toMatchObject({ ok: true, content: { policy: { policyText } } });
    expect(
      h.sqlite
        .prepare('SELECT policy_text FROM annual_bid_policy_documents WHERE id=?')
        .get(version.row.policy_document_id),
    ).toEqual({ policy_text: policyText });
  });

  it.each(['document', 'pre-document'] as const)(
    'keeps incomplete saved %s material blocked at Live readiness after sealed preparation',
    async (kind) => {
      const version = await savedVersion((content) => {
        const policy = syntheticLivePolicy();
        content.settings = {
          v: 3,
          expectedDurationDays: 2,
          turnTimerSeconds: 180,
          credentialEvaluationOn: '2027-01-01',
          personnelEvaluationOn: '2027-01-01',
          livePolicy: policy,
        };
        content.policy =
          kind === 'document'
            ? {
                policyText: 'Synthetic draft language is not publication approval.',
                executionPolicy: policy,
              }
            : null;
      });
      expect(
        h.sqlite
          .prepare('SELECT status FROM rule_books WHERE version=?')
          .get(version.row.rule_book_version),
      ).toEqual({ status: 'draft' });
      const result = await readOnly(() =>
        prepareBidDefinitionRun(h.env.DB, input(version, { mode: 'live' })),
      );
      if (!result.ok) throw new Error(JSON.stringify(result));
      const readiness = await readOnly(() =>
        evaluateLiveBidReadiness({
          db: getDb(h.env.DB),
          env: h.env,
          bidSessionId: SESSION,
          bidYear: 2027,
          frozenPolicy: { ok: true, snapshot: result.snapshot, coverage: result.coverage },
          operatorAuthorized: true,
        }),
      );
      expect(readiness.canStartLiveBid).toBe(false);
      expect(readiness.blockingCheckIds).toEqual(
        expect.arrayContaining([
          'accepted_staffing_baseline',
          'participant_population',
          'execution_policy_references',
          'annual_operations_policy',
          'ordering_authority',
        ]),
      );
    },
  );
});
