import { deepStrictEqual } from 'node:assert';
import {
  BidDispositionSchema,
  type BidEvaluation,
  BidEvaluationSchema,
  type BidSessionPolicySnapshot,
  BidSessionPolicySnapshotSchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { bidDefinitionContextHash } from '../../src/lib/bid-definition-context.js';
import {
  type BidEvaluationMaterial,
  evaluateRuleBookCoverage,
  loadBidEvaluationEvidence,
  prepareBidSessionPolicySnapshot,
  prepareCapturedBidEvaluation,
  referencedBidEvaluationDisputes,
} from '../../src/lib/bid-policy.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const CAPTURED_AT = Date.parse('2027-02-10T14:23:45.678Z');
const REQUIRED = '{"rank":["FF"],"credentials":[],"custom":[]}';
const POINTS = '{"max":0,"items":[]}';
const TIES = '["rsc_seniority"]';
const JANUARY = 'Synthetic January credential';
const FEBRUARY = 'Synthetic February credential';
type Snapshot = Extract<BidSessionPolicySnapshot, { v: 3 }>;

function first<T>(rows: T[]): T {
  const value = rows[0];
  if (value === undefined) throw new Error('Missing explicit synthetic fixture row');
  return value;
}

// Literal expectations from the pre-extraction V3 contract. This does not call
// the new evaluator or snapshot parser to manufacture its expected result.
function expectedSnapshot(): Snapshot {
  return {
    v: 3,
    ruleBookVersion: '2027.1',
    ruleBookRevision: 4,
    positionTemplateVersion: '2027.1',
    configurationRevision: 3,
    settings: {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      personnelEvaluationOn: '2027-01-01',
    },
    credentialEvaluationOn: '2027-01-01',
    capturedAtMs: CAPTURED_AT,
    members: [
      {
        memberId: 10001,
        pool: 'FF',
        rscSeniority: 1,
        rankSeniority: null,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'FF',
        isProbationary: false,
        credentialNames: [JANUARY],
        scoringEvidence: { evaluationOn: '2027-01-01', completedCredentialNames: [JANUARY] },
        serviceCredits: [],
        specialtyQualifications: [],
      },
      {
        memberId: 10002,
        pool: 'EXCLUDED',
        rscSeniority: 2,
        rankSeniority: null,
        exclusionReason: 'MEMBER_EMPLOYMENT_UNCONFIRMED',
        authoritativeAssignmentId: null,
        rank: 'FF',
        isProbationary: false,
        credentialNames: [],
        scoringEvidence: { evaluationOn: '2027-01-01', completedCredentialNames: [] },
        serviceCredits: [],
        specialtyQualifications: [],
      },
      {
        memberId: 10003,
        pool: 'FF',
        rscSeniority: 3,
        rankSeniority: null,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'FF',
        isProbationary: false,
        credentialNames: [],
        scoringEvidence: { evaluationOn: '2027-01-01', completedCredentialNames: [] },
        serviceCredits: [],
        specialtyQualifications: [],
      },
    ],
    tenureEvidence: [],
    authoringCredentialNames: [FEBRUARY, JANUARY],
    operatorIdentityProjection: [
      {
        memberId: 10001,
        employeeId: 'synthetic-extraction-active',
        firstName: 'Synthetic',
        lastName: 'Active',
        rank: 'FF',
      },
      {
        memberId: 10002,
        employeeId: 'synthetic-extraction-unknown',
        firstName: 'Synthetic',
        lastName: 'Unknown',
        rank: 'FF',
      },
      {
        memberId: 10003,
        employeeId: 'synthetic-extraction-retiring',
        firstName: 'Synthetic',
        lastName: 'Retiring',
        rank: 'FF',
      },
    ],
    ruleBookMaterial: {
      v: 1,
      rules: [
        {
          ruleBookVersion: '2027.1',
          positionId: 'synthetic-seat',
          templateVersion: '2027.1',
          requiredCriteriaJson: REQUIRED,
          pointsPreferenceJson: POINTS,
          tieBreakChainJson: TIES,
        },
      ],
      positions: [
        {
          id: 'synthetic-seat',
          templateVersion: '2027.1',
          bidParticipation: 'BIDDABLE',
          isExcludedFromCount: false,
          shift: 'A',
          station: '7',
          unit: 'Synthetic Engine',
          rankRequired: 'FF',
          positionName: 'Synthetic firefighter',
          division: 'Combat',
          isFloating: false,
          isVacantByDesign: false,
        },
      ],
    },
  };
}

function evaluationFixture(): BidEvaluation {
  const {
    v: _v,
    ruleBookRevision: _r,
    configurationRevision: _c,
    annualPolicyEvidence: _a,
    ...evaluation
  } = expectedSnapshot();
  return evaluation;
}

function material(
  date = '2027-01-01',
  references: readonly string[] = [REQUIRED, POINTS],
): BidEvaluationMaterial {
  const expected = expectedSnapshot();
  return {
    bidYear: 2027,
    settings: {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: date,
      personnelEvaluationOn: date,
    },
    coverage: evaluateRuleBookCoverage({
      ruleBookVersion: '2027.1',
      rules: expected.ruleBookMaterial.rules,
      positions: expected.ruleBookMaterial.positions,
    }),
    bindings: [],
    ruleBookMaterial: expected.ruleBookMaterial,
    sourceDecisions: [],
    policyReferenceJson: references,
  };
}

function withSpecialty(evaluation: BidEvaluation) {
  const member = first(evaluation.members);
  member.specialtyQualifications = [
    { specialtyCode: 'ALPHA', status: 'active', effectiveOn: '2026-01-01', expiresOn: null },
  ];
  return first(member.specialtyQualifications);
}

describe('Bid evaluation and frozen snapshot shared refinements', () => {
  const cases: { name: string; path: (string | number)[]; change(value: BidEvaluation): void }[] = [
    {
      name: 'duplicate member',
      path: ['members', 3, 'memberId'],
      change: (v) => {
        v.members.push(structuredClone(first(v.members)));
      },
    },
    {
      name: 'excluded without reason',
      path: ['members', 0, 'exclusionReason'],
      change: (v) => {
        first(v.members).pool = 'EXCLUDED';
      },
    },
    {
      name: 'included with reason',
      path: ['members', 0, 'exclusionReason'],
      change: (v) => {
        first(v.members).exclusionReason = 'MEMBER_NOT_ACTIVE';
      },
    },
    {
      name: 'administrative exclusion without assignment',
      path: ['members', 0, 'authoritativeAssignmentId'],
      change: (v) => {
        Object.assign(first(v.members), {
          pool: 'EXCLUDED',
          exclusionReason: 'ADMIN_ASSIGNED_NON_BIDDABLE',
        });
      },
    },
    {
      name: 'civilian in Bid pool',
      path: ['members', 0, 'pool'],
      change: (v) => {
        first(v.members).rank = 'CIVILIAN';
      },
    },
    {
      name: 'missing credential evaluation date',
      path: ['credentialEvaluationOn'],
      change: (v) => {
        Reflect.deleteProperty(v, 'credentialEvaluationOn');
      },
    },
    {
      name: 'mismatched evaluation date',
      path: ['credentialEvaluationOn'],
      change: (v) => {
        v.credentialEvaluationOn = '2027-01-02';
      },
    },
    {
      name: 'duplicate completion evidence',
      path: ['members', 0, 'scoringEvidence'],
      change: (v) => {
        first(v.members).scoringEvidence = {
          evaluationOn: '2027-01-01',
          completedCredentialNames: [JANUARY, JANUARY],
        };
      },
    },
    {
      name: 'case-fold duplicate credential',
      path: ['members', 0, 'credentialNames', 1],
      change: (v) => {
        first(v.members).credentialNames.push(` ${JANUARY.toLowerCase()} `);
      },
    },
    {
      name: 'duplicate specialty',
      path: ['members', 0, 'specialtyQualifications', 1, 'specialtyCode'],
      change: (v) => {
        const specialty = withSpecialty(v);
        first(v.members).specialtyQualifications?.push({ ...specialty });
      },
    },
    {
      name: 'unsorted specialties',
      path: ['members', 0, 'specialtyQualifications', 1, 'specialtyCode'],
      change: (v) => {
        const specialty = withSpecialty(v);
        first(v.members).specialtyQualifications = [
          { ...specialty, specialtyCode: 'ZULU' },
          specialty,
        ];
      },
    },
    {
      name: 'future specialty',
      path: ['members', 0, 'specialtyQualifications', 0, 'effectiveOn'],
      change: (v) => {
        withSpecialty(v).effectiveOn = '2027-01-02';
      },
    },
    {
      name: 'expired active specialty',
      path: ['members', 0, 'specialtyQualifications', 0, 'expiresOn'],
      change: (v) => {
        withSpecialty(v).expiresOn = '2026-12-31';
      },
    },
    {
      name: 'premature expired specialty',
      path: ['members', 0, 'specialtyQualifications', 0, 'expiresOn'],
      change: (v) => {
        Object.assign(withSpecialty(v), { status: 'expired', expiresOn: '2027-01-02' });
      },
    },
    {
      name: 'duplicate opportunity',
      path: ['ruleBookMaterial', 'positions', 1, 'id'],
      change: (v) => {
        v.ruleBookMaterial.positions.push({ ...first(v.ruleBookMaterial.positions) });
      },
    },
    {
      name: 'wrong opportunity template',
      path: ['ruleBookMaterial', 'positions', 0, 'templateVersion'],
      change: (v) => {
        first(v.ruleBookMaterial.positions).templateVersion = 'another-template';
      },
    },
    {
      name: 'duplicate rule',
      path: ['ruleBookMaterial', 'rules', 1, 'positionId'],
      change: (v) => {
        v.ruleBookMaterial.rules.push({ ...first(v.ruleBookMaterial.rules) });
      },
    },
    {
      name: 'wrong rule book',
      path: ['ruleBookMaterial', 'rules', 0, 'ruleBookVersion'],
      change: (v) => {
        first(v.ruleBookMaterial.rules).ruleBookVersion = 'another-book';
      },
    },
    {
      name: 'wrong rule template',
      path: ['ruleBookMaterial', 'rules', 0, 'templateVersion'],
      change: (v) => {
        first(v.ruleBookMaterial.rules).templateVersion = 'another-template';
      },
    },
  ];
  it.each(cases)('retains exactly the same failure issues for $name', ({ path, change }) => {
    const evaluation = evaluationFixture();
    change(evaluation);
    const calculated = BidEvaluationSchema.safeParse(evaluation);
    const frozen = BidSessionPolicySnapshotSchema.safeParse({
      ...expectedSnapshot(),
      ...evaluation,
      credentialEvaluationOn: evaluation.credentialEvaluationOn,
    });
    expect(calculated.success).toBe(false);
    expect(frozen.success).toBe(false);
    if (calculated.success || frozen.success)
      throw new Error('Invalid synthetic fixture unexpectedly accepted');
    expect(calculated.error.issues).toStrictEqual(frozen.error.issues);
    expect(calculated.error.issues).toContainEqual(
      expect.objectContaining({ code: 'custom', path }),
    );
  });

  it('keeps annual document provenance validation at the session boundary and forbids claiming it as an evaluation', () => {
    const annualPolicyEvidence = {
      documentId: 'synthetic-document',
      documentRevision: 1,
      ruleBookVersion: 'another-book',
      executablePolicyRevision: 'synthetic-policy',
      policyText: 'Synthetic policy text',
    };
    const frozen = BidSessionPolicySnapshotSchema.safeParse({
      ...expectedSnapshot(),
      annualPolicyEvidence,
    });
    expect(frozen.success).toBe(false);
    if (frozen.success) throw new Error('Wrong annual policy book accepted');
    expect(frozen.error.issues).toContainEqual({
      code: 'custom',
      path: ['annualPolicyEvidence', 'ruleBookVersion'],
      message: 'annual policy evidence rule book must match the session snapshot',
    });
    expect(
      BidEvaluationSchema.safeParse({ ...evaluationFixture(), annualPolicyEvidence }).success,
    ).toBe(false);
    expect(BidEvaluationSchema.parse(evaluationFixture())).toStrictEqual(evaluationFixture());
  });

  it('retains the exact executable-revision guard while accepting a document-free V3 evaluation', () => {
    const value = expectedSnapshot();
    const settings = {
      ...value.settings,
      v: 3 as const,
      credentialEvaluationOn: '2027-01-01',
      livePolicy: {
        v: 1 as const,
        policyRevision: 'synthetic-executable-revision',
        stages: [
          {
            id: 'synthetic-stage',
            label: 'Synthetic stage',
            order: 0,
            memberIds: [10001, 10003],
            opportunityPositionIds: ['synthetic-seat'],
            kind: 'FIREFIGHTER' as const,
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
      },
    };
    const evidence = {
      documentId: 'synthetic-document',
      documentRevision: 1,
      ruleBookVersion: '2027.1',
      executablePolicyRevision: settings.livePolicy.policyRevision,
      policyText: '  Synthetic policy text\n',
    };
    expect(BidEvaluationSchema.parse({ ...evaluationFixture(), settings })).not.toHaveProperty(
      'annualPolicyEvidence',
    );
    expect(
      BidSessionPolicySnapshotSchema.parse({ ...value, settings, annualPolicyEvidence: evidence }),
    ).toMatchObject({ annualPolicyEvidence: { policyText: 'Synthetic policy text' } });
    const invalid = BidSessionPolicySnapshotSchema.safeParse({
      ...value,
      settings,
      annualPolicyEvidence: { ...evidence, executablePolicyRevision: 'different-revision' },
    });
    expect(invalid.success).toBe(false);
    if (invalid.success) throw new Error('Mismatched executable revision accepted');
    expect(invalid.error.issues).toEqual([
      {
        code: 'custom',
        path: ['annualPolicyEvidence', 'executablePolicyRevision'],
        message: 'annual policy evidence must name the frozen executable policy revision',
      },
    ]);
  });

  it.each([1, 2] as const)(
    'keeps V%s recovery snapshots readable without manufacturing V3 evaluation material',
    (v) => {
      const value = {
        v,
        ruleBookVersion: 'legacy-book',
        positionTemplateVersion: 'legacy-template',
        capturedAtMs: 1,
        members: [],
        ...(v === 2
          ? {
              ruleBookRevision: 1,
              configurationRevision: 1,
              settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
            }
          : {}),
      };
      expect(BidSessionPolicySnapshotSchema.parse(value)).toStrictEqual(value);
      expect(BidEvaluationSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('Bid evaluation extraction with a real common Department capture', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,
        employment_status,employment_status_effective_on,created_at,updated_at)
      VALUES (10001,'synthetic-extraction-active','Synthetic','Active','FF','FF',1,0,'active','2020-01-01',1,1),
        (10002,'synthetic-extraction-unknown','Synthetic','Unknown','FF','FF',2,0,'unknown',NULL,1,1),
        (10003,'synthetic-extraction-retiring','Synthetic','Retiring','FF','FF',3,0,'active','2020-01-01',1,1);
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic extraction topology');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',4,'Synthetic extraction policy');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',3,'{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-01","personnelEvaluationOn":"2027-01-01"}');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('synthetic-seat','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic firefighter');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','synthetic-seat','2027.1','${REQUIRED}','${POINTS}','${TIES}');
      INSERT INTO credentials (id,name) VALUES (7001,'${JANUARY}'),(7002,'${FEBRUARY}');
      INSERT INTO member_credentials (member_id,credential_id,start_date,expiration_date)
        VALUES (10001,7001,'2026-01-01','2027-01-15'),(10001,7002,'2027-02-01',NULL);
      INSERT INTO personnel_lifecycle_events
        (id,member_id,staffing_position_id,member_assignment_id,kind,effective_on,employment_status_before,
         employment_status_after,rank_before,rank_after,separation_type,reason,origin,actor_subject,
         idempotency_key,before_state,after_state,created_at)
        VALUES ('synthetic-extraction-retirement',10003,NULL,NULL,'RETIREMENT','2027-01-15','active','retired','FF','FF',
          'RETIREMENT','Synthetic dated retirement evidence','ADMIN','synthetic-editor','synthetic-extraction-retirement',
          '{"employmentStatus":"active","employmentStatusEffectiveOn":"2020-01-01","separationType":null,"rank":"FF"}',
          '{"employmentStatus":"retired","separationType":"RETIREMENT","rank":"FF"}',1);
    `);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    await teardownTestD1(h);
  });

  async function readOnly<T>(work: () => Promise<T>) {
    const bytes = h.sqlite.serialize();
    const result = await work();
    deepStrictEqual(h.sqlite.serialize(), bytes);
    return result;
  }

  function dispute(
    input: {
      memberId?: number | null;
      observedOn?: string;
      expiresOn?: string | number | null;
      classification?: string;
      applied?: boolean;
    } = {},
  ) {
    h.sqlite
      .prepare(
        `INSERT INTO targetsolutions_imports (id,filename,observed_on,source_row_count,unique_row_count,coverage_json,status,created_by,created_at) VALUES ('synthetic-dispute-import','synthetic.csv',?,1,1,'{}','reviewed','synthetic-editor',1)`,
      )
      .run(input.observedOn ?? '2027-02-01');
    h.sqlite
      .prepare(
        `INSERT INTO targetsolutions_rows (id,import_id,row_number,source_json,member_id,credential_id,classification,applied_at) VALUES ('synthetic-dispute-row','synthetic-dispute-import',1,?,?,7002,?,?)`,
      )
      .run(
        JSON.stringify({ sourceName: FEBRUARY, expiresOn: input.expiresOn ?? null }),
        input.memberId === undefined ? 10001 : input.memberId,
        input.classification ?? 'CONFLICT',
        input.applied ? 1 : null,
      );
  }

  it('preserves the complete literal V3 JSON and context through the persisted adapter', async () => {
    const result = await readOnly(() =>
      prepareBidSessionPolicySnapshot(getDb(h.env.DB), 2027, CAPTURED_AT, 'mock'),
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(JSON.stringify(result.snapshot)).toBe(JSON.stringify(expectedSnapshot()));
    const evidence = await readOnly(() => loadBidEvaluationEvidence(getDb(h.env.DB), 2027));
    const calculated = await readOnly(() =>
      prepareCapturedBidEvaluation(getDb(h.env.DB), material(), evidence, CAPTURED_AT, 'mock'),
    );
    expect(calculated.ok, JSON.stringify(calculated)).toBe(true);
    if (!calculated.ok) throw new Error(calculated.code);
    expect(calculated.evaluation).toStrictEqual(evaluationFixture());
    expect(calculated.coverage).toStrictEqual(result.coverage);
    expect(bidDefinitionContextHash(calculated.evaluation)).toBe(
      bidDefinitionContextHash(result.snapshot),
    );
    expect(calculated.evaluation).not.toHaveProperty('configurationRevision');
    expect(calculated.evaluation).not.toHaveProperty('annualPolicyEvidence');
  });

  it('projects the final 2026 source cohort before stage-authoring completeness is evaluated', async () => {
    h.sqlite.exec(`
      UPDATE members
      SET employee_id = '18158', rank = 'DC', bid_category = 'OFC'
      WHERE id = 10001;
      UPDATE members
      SET employee_id = '14326', rank = 'CPT', bid_category = 'OFC'
      WHERE id = 10002;
    `);
    const db = getDb(h.env.DB);
    const evidence = await readOnly(() => loadBidEvaluationEvidence(db, 2027));
    const final2026 = material();
    final2026.bidYear = 2026;

    const result = await readOnly(() =>
      prepareCapturedBidEvaluation(db, final2026, evidence, CAPTURED_AT, 'participant_preview'),
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.evaluation.members.find((member) => member.memberId === 10001)).toMatchObject({
      pool: 'OFC',
      rank: 'CPT',
      exclusionReason: null,
    });
    expect(result.evaluation.members.find((member) => member.memberId === 10002)).toMatchObject({
      pool: 'EXCLUDED',
      rank: 'CPT',
      exclusionReason: 'MEMBER_CATEGORY_EXCLUDED',
    });
    expect(
      result.evaluation.operatorIdentityProjection?.find((member) => member.memberId === 10001),
    ).toMatchObject({ employeeId: '18158', rank: 'CPT' });

    h.sqlite.exec(`
      UPDATE members
      SET employee_id = '99991'
      WHERE id = 10001;
    `);
    const executiveEvidence = await readOnly(() => loadBidEvaluationEvidence(db, 2027));
    const executiveResult = await readOnly(() =>
      prepareCapturedBidEvaluation(
        db,
        final2026,
        executiveEvidence,
        CAPTURED_AT,
        'participant_preview',
      ),
    );
    expect(executiveResult.ok, JSON.stringify(executiveResult)).toBe(true);
    if (!executiveResult.ok) throw new Error(executiveResult.code);
    expect(
      executiveResult.evaluation.members.find((member) => member.memberId === 10001),
    ).toMatchObject({
      pool: 'EXCLUDED',
      rank: 'DC',
      exclusionReason: 'MEMBER_CATEGORY_EXCLUDED',
    });
    expect(
      executiveResult.evaluation.operatorIdentityProjection?.find(
        (member) => member.memberId === 10001,
      ),
    ).toMatchObject({ employeeId: '99991', rank: 'DC' });
  });

  it('uses one raw capture across qualification and personnel date boundaries with no later live-table read', async () => {
    const evidence = await readOnly(() => loadBidEvaluationEvidence(getDb(h.env.DB), 2027));
    const captureBefore = structuredClone(evidence);
    const query = vi.spyOn(h.env.DB, 'prepare');
    const results: BidEvaluation[] = [];
    for (const date of ['2027-01-01', '2027-01-15', '2027-01-16', '2027-02-01']) {
      const result = await readOnly(() =>
        prepareCapturedBidEvaluation(
          getDb(h.env.DB),
          material(date),
          evidence,
          CAPTURED_AT,
          'mock',
        ),
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) throw new Error(result.code);
      results.push(result.evaluation);
    }
    expect(results.map((value) => first(value.members).credentialNames)).toEqual([
      [JANUARY],
      [JANUARY],
      [],
      [FEBRUARY],
    ]);
    expect(
      results.map((value) => value.members.find((member) => member.memberId === 10003)?.pool),
    ).toEqual(['FF', 'EXCLUDED', 'EXCLUDED', 'EXCLUDED']);
    expect(first(results.at(-1)?.members ?? []).scoringEvidence?.completedCredentialNames).toEqual([
      FEBRUARY,
      JANUARY,
    ]);
    expect(new Set(results.map(bidDefinitionContextHash)).size).toBe(4);
    expect(evidence).toStrictEqual(captureBefore);
    expect(query).toHaveBeenCalledTimes(4);
    for (const [sql] of query.mock.calls) {
      expect(sql).toContain('WITH captured AS');
      expect(sql).not.toMatch(
        /\b(?:members|member_credentials|targetsolutions_rows|position_rules|annual_bid_policy_documents)\b/,
      );
    }
  });

  it('uses a candidate-only credential reference against the same captured dispute after live mapping changes', async () => {
    dispute({ observedOn: '2027-01-01' });
    const db = getDb(h.env.DB);
    const evidence = await readOnly(() => loadBidEvaluationEvidence(db, 2027));
    h.sqlite.exec('UPDATE targetsolutions_rows SET credential_id=7001');
    const raw = structuredClone(evidence);
    const query = vi.spyOn(h.env.DB, 'prepare');
    const baseline = await readOnly(() =>
      prepareCapturedBidEvaluation(db, material(), evidence, CAPTURED_AT, 'mock'),
    );
    const candidate = material('2027-01-01', [
      JSON.stringify({ rank: ['FF'], credentials: [FEBRUARY], custom: [] }),
      POINTS,
    ]);
    first(candidate.ruleBookMaterial.rules).requiredCriteriaJson = first([
      ...candidate.policyReferenceJson,
    ]);
    candidate.coverage = evaluateRuleBookCoverage({
      ruleBookVersion: '2027.1',
      rules: candidate.ruleBookMaterial.rules,
      positions: candidate.ruleBookMaterial.positions,
    });
    expect(baseline.ok).toBe(true);
    expect(
      await readOnly(() =>
        prepareCapturedBidEvaluation(db, candidate, evidence, CAPTURED_AT, 'mock'),
      ),
    ).toEqual({ ok: false, code: 'credential_import_dispute_requires_review' });
    expect(evidence).toStrictEqual(raw);
    expect(query.mock.calls.every(([sql]) => sql.includes('WITH captured AS'))).toBe(true);
    expect(h.sqlite.prepare('SELECT required_criteria FROM position_rules').get()).toEqual({
      required_criteria: REQUIRED,
    });
  });

  it.each([
    ['before observation', '2027-01-31', null, false],
    ['on observation', '2027-02-01', null, true],
    ['expiration equals evaluation', '2027-01-15', '2027-01-15', false],
    ['expiration before evaluation', '2027-01-16', '2027-01-15', true],
    ['numeric expiration retains SQLite type semantics', '2027-01-01', 0, true],
  ] as const)(
    'preserves the original dispute date predicate: %s',
    async (_label, evaluationOn, expiresOn, blocks) => {
      dispute({ expiresOn });
      const db = getDb(h.env.DB);
      const evidence = await readOnly(() => loadBidEvaluationEvidence(db, 2027));
      const selected = material(evaluationOn, [JSON.stringify({ credentials: [FEBRUARY] })]);
      const found = await readOnly(() => referencedBidEvaluationDisputes(db, evidence, selected));
      expect(found).toEqual(blocks ? [{ memberId: 10001 }] : []);
    },
  );

  it.each(['criteria', 'points', 'execution policy'] as const)(
    'finds nested candidate %s references through the original JSON-tree semantics',
    async (location) => {
      dispute({ observedOn: '2027-01-01' });
      const nested = JSON.stringify({ nested: { groups: [{ alternatives: [FEBRUARY] }] } });
      const refs =
        location === 'criteria'
          ? [nested, POINTS]
          : location === 'points'
            ? [REQUIRED, nested]
            : [REQUIRED, POINTS, nested];
      const db = getDb(h.env.DB);
      const evidence = await readOnly(() => loadBidEvaluationEvidence(db, 2027));
      expect(
        await readOnly(() =>
          referencedBidEvaluationDisputes(db, evidence, material('2027-01-01', refs)),
        ),
      ).toEqual([{ memberId: 10001 }]);
      expect(
        await readOnly(() =>
          referencedBidEvaluationDisputes(
            db,
            evidence,
            material('2027-01-01', [JSON.stringify({ [FEBRUARY]: 'unrelated value' })]),
          ),
        ),
      ).toEqual([]);
    },
  );

  it.each([
    ['resolved application', { applied: true }],
    ['inactive classification', { classification: 'UNCHANGED' }],
    ['unmapped member', { memberId: null }],
    ['excluded member', { memberId: 10002 }],
  ] as const)('does not block a participating member for a %s', async (_label, overrides) => {
    dispute({ ...overrides, observedOn: '2027-01-01' });
    const db = getDb(h.env.DB);
    const evidence = await readOnly(() => loadBidEvaluationEvidence(db, 2027));
    const result = await readOnly(() =>
      prepareCapturedBidEvaluation(
        db,
        material('2027-01-01', [JSON.stringify({ credentials: [FEBRUARY] })]),
        evidence,
        CAPTURED_AT,
        'mock',
      ),
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });
});
