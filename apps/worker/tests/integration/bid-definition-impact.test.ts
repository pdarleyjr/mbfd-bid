import { deepStrictEqual } from 'node:assert';
import { compareWithTrace, evaluateEligibility } from '@mbfd/eligibility';
import {
  type BidDefinitionContent,
  BidDispositionSchema,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index.js';
import { canonicalBidDefinition } from '../../src/lib/bid-definition-content.js';
import { loadCurrentBidDefinition } from '../../src/lib/bid-definition-facade.js';
import {
  type BidImpactRequest,
  BidImpactRequestSchema,
  type previewBidDefinitionImpact,
} from '../../src/lib/bid-definition-impact.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const YEAR = 2027;
const ONE = 10001;
const TWO = 10002;
const UNKNOWN = 10003;
const RETIRING = 10004;
const SEAT = 'synthetic-impact-a';
const OTHER = 'synthetic-impact-b';
const CREDENTIAL_A = 'Synthetic credential A';
const CREDENTIAL_B = 'Synthetic credential B';
const HASH = /^[0-9a-f]{64}$/;
type ServiceResult = Awaited<ReturnType<typeof previewBidDefinitionImpact>>;
type Impact = Extract<Extract<ServiceResult, { ok: true }>['response'], { valid: true }>;
type Expected = BidImpactRequest['expected'];

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error('Missing synthetic fixture value');
  return value;
}
function evaluated(side: Impact['before']) {
  expect(side.status).toBe('EVALUATED');
  if (side.status !== 'EVALUATED') throw new Error(JSON.stringify(side));
  return side;
}
function compared(value: Impact) {
  expect(value.comparison.status).toBe('EVALUATED');
  if (value.comparison.status !== 'EVALUATED') throw new Error(JSON.stringify(value.comparison));
  return value.comparison;
}
function trace(value: Impact, side: 'before' | 'after') {
  const result = value.trace?.[side];
  expect(result?.status).toBe('EVALUATED');
  if (result?.status !== 'EVALUATED') throw new Error(JSON.stringify(result));
  return result;
}
function noInternalMaterial(value: unknown): void {
  const forbidden = [
    'sourceGuard',
    'sql',
    'parameters',
    'snapshotJson',
    'snapshot',
    'pins',
    'serialized',
    'selectedSourceSnapshotJson',
    'config_json',
  ];
  if (Array.isArray(value)) value.forEach(noInternalMaterial);
  else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      expect(forbidden, `Internal DTO property ${key}`).not.toContain(key);
      noInternalMaterial(child);
    }
  }
  if (typeof value === 'string') expect(value).not.toBe('bid-definition-content-v1');
}

describe('actual unsaved Bid impact through the admin facade', () => {
  let h: TestD1;
  let auth: string;
  let content: BidDefinitionContent;
  let expected: Expected;
  let saveNumber: number;

  async function token(role: 'admin' | 'member' = 'admin', fresh = true) {
    return signJwt(
      {
        sub: ONE,
        emp: 'synthetic-impact-10001',
        role,
        rank: 'FF',
        first_name: 'Synthetic',
        last_name: 'First',
        fresh_auth_at: Math.floor(Date.now() / 1000) - (fresh ? 0 : 86400),
      },
      h.env.JWT_SIGNING_KEY,
    );
  }
  async function refreshCurrent() {
    const current = await loadCurrentBidDefinition(h.env.DB, YEAR);
    if (!current.ok) throw new Error(JSON.stringify(current));
    content = structuredClone(current.response.content);
    expected = current.response.expected;
    return current.response;
  }
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,
        employment_status,employment_status_effective_on,created_at,updated_at)
      VALUES (10001,'synthetic-impact-10001','Synthetic','First','FF','FF',1,0,'active','2020-01-01',1,1),
        (10002,'synthetic-impact-10002','Synthetic','Second','FF','FF',2,0,'active','2020-01-01',1,1),
        (10003,'synthetic-impact-10003','Synthetic','Unknown','FF','FF',3,0,'unknown',NULL,1,1),
        (10004,'synthetic-impact-10004','Synthetic','Retiring','FF','FF',4,0,'active','2020-01-01',1,1);
      INSERT INTO position_templates(version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic impact topology');
      INSERT INTO rule_books(version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',4,'Synthetic impact policy');
      INSERT INTO bid_years(year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',3,'{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-01","personnelEvaluationOn":"2027-01-01"}');
      INSERT INTO positions(id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('${SEAT}','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic firefighter A'),
          ('${OTHER}','2027.1','B','8','Combat','Synthetic Ladder','FF','Synthetic firefighter B');
      INSERT INTO position_rules(rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','${SEAT}','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}','{"max":0,"items":[]}','["rsc_seniority"]'),
          ('2027.1','${OTHER}','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}','{"max":0,"items":[]}','["rsc_seniority"]');
      INSERT INTO credentials(id,name) VALUES (7001,'${CREDENTIAL_A}'),(7002,'${CREDENTIAL_B}');
      INSERT INTO member_credentials(member_id,credential_id,start_date,expiration_date)
        VALUES (10001,7001,'2026-01-01','2027-01-15'),(10002,7002,'2026-01-01',NULL);
      INSERT INTO personnel_lifecycle_events
        (id,member_id,kind,effective_on,employment_status_before,employment_status_after,rank_before,rank_after,
         separation_type,reason,origin,actor_subject,idempotency_key,before_state,after_state,created_at)
        VALUES ('synthetic-impact-retirement',10004,'RETIREMENT','2027-01-15','active','retired','FF','FF','RETIREMENT',
          'Synthetic retirement','ADMIN','synthetic-editor','synthetic-impact-retirement',
          '{"employmentStatus":"active","employmentStatusEffectiveOn":"2020-01-01","separationType":null,"rank":"FF"}',
          '{"employmentStatus":"retired","separationType":"RETIREMENT","rank":"FF"}',1);
    `);
    saveNumber = 0;
    await refreshCurrent();
    auth = await token();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    await teardownTestD1(h);
  });

  function body(candidate: unknown = content, overrides: Partial<BidImpactRequest> = {}) {
    return BidImpactRequestSchema.parse({
      kind: 'impact',
      expected,
      intent: { operation: 'save', content: candidate },
      mode: 'mock',
      ...overrides,
    });
  }
  function request(
    value: unknown,
    options: { year?: string; authorization?: string | null; raw?: boolean } = {},
  ) {
    const authorization = options.authorization === undefined ? auth : options.authorization;
    return app.fetch(
      new Request(`http://x/api/admin/bid/${options.year ?? YEAR}/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authorization === null ? {} : { Authorization: `Bearer ${authorization}` }),
        },
        body: options.raw ? String(value) : JSON.stringify(value),
      }),
      h.env,
    );
  }
  async function readonlyRequest(value: unknown, options: Parameters<typeof request>[1] = {}) {
    const before = h.sqlite.serialize();
    const doLookup = vi.spyOn(h.env.BID_SESSION, 'get');
    const response = await request(value, options);
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(doLookup).not.toHaveBeenCalled();
    if (response.status === 200)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    return response;
  }
  async function impact(value = body()) {
    const response = await readonlyRequest(value);
    const result = (await response.json()) as Impact;
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.valid).toBe(true);
    noInternalMaterial(result);
    return result;
  }
  async function save(candidate: BidDefinitionContent = content) {
    const result = await saveBidDefinition(h.env.DB, {
      year: YEAR,
      key: `synthetic-impact-save-${++saveNumber}`,
      actorSubject: 'synthetic-editor',
      actorId: ONE,
      expected,
      reason: 'Synthetic reviewed saved baseline',
      intent: { operation: 'save', content: candidate },
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    await refreshCurrent();
    return String(result.response.versionId);
  }
  function requireCredential(candidate: BidDefinitionContent, credential = CREDENTIAL_A) {
    first(candidate.rules).requiredCriteriaJson = JSON.stringify({
      rank: ['FF'],
      credentials: [credential],
      custom: [],
    });
    return candidate;
  }
  function policy(candidate: BidDefinitionContent) {
    const livePolicy = FrozenLiveBidPolicySchema.parse({
      v: 1,
      policyRevision: 'synthetic-impact-live-policy',
      stages: [
        {
          id: 'stage-one',
          label: 'Synthetic first',
          order: 0,
          memberIds: [ONE],
          opportunityPositionIds: [SEAT],
          kind: 'FIREFIGHTER',
        },
        {
          id: 'stage-two',
          label: 'Synthetic second',
          order: 1,
          memberIds: [TWO, RETIRING],
          opportunityPositionIds: [OTHER],
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
        actorMemberIds: [ONE],
      })),
      specialtyCatalogReference: null,
      aDayPolicyReference: null,
      transitionPolicyReference: null,
      publicationPolicyReference: null,
    });
    candidate.settings = {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      personnelEvaluationOn: '2027-01-01',
      livePolicy,
    };
    candidate.policy = {
      policyText: 'Synthetic executable policy for impact tests',
      executionPolicy: structuredClone(livePolicy),
    };
    return candidate;
  }
  function alterPolicy(
    candidate: BidDefinitionContent,
    change: (value: ReturnType<typeof FrozenLiveBidPolicySchema.parse>) => void,
  ) {
    if (candidate.settings?.v !== 3 || !candidate.policy)
      throw new Error('Synthetic V3 policy missing');
    change(candidate.settings.livePolicy);
    candidate.policy.executionPolicy = structuredClone(candidate.settings.livePolicy);
  }
  function specialty(candidate: BidDefinitionContent) {
    policy(candidate);
    alterPolicy(candidate, (value) => {
      value.annualOperations = {
        v: 1,
        stageOrder: ['stage-one', 'stage-two'],
        requiredTopologyPositionIds: [SEAT, OTHER],
        specialties: [
          {
            id: 'synthetic-priority',
            label: 'Synthetic priority',
            mode: 'PRIORITY_ONLY',
            opportunityPositionIds: [SEAT],
            requiredCredentialNames: [CREDENTIAL_B],
            requiredSpecialtyCodes: [],
            points: [{ credentialName: CREDENTIAL_B, value: 5 }],
            tieBreakChain: ['POINTS', 'RSC_SENIORITY'],
          },
        ],
        contact: { minimumAttempts: 1, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
        aDay: {
          combatGroups: ['G1', 'G2', 'G3', 'G4'],
          min: 0,
          max: 20,
          captainDcMax: 5,
          specialtyMaximums: { MARINE_ASSIGNED: 5, MARINE_FLOAT: 5, DE: 5, SWAT: 5 },
        },
      };
    });
    return candidate;
  }

  it('returns actual unchanged populations and no invented run or selection result without any database or DO write', async () => {
    const result = await impact();
    expect(result.source.kind).toBe('UNSAVED_DRAFT');
    expect(result.source.baselineContentSha256).toBe(result.source.candidateContentSha256);
    expect(result.impactSha256).toMatch(HASH);
    expect(result.runtimeSourceToken).toMatch(HASH);
    expect(evaluated(result.before).contextSha256).toBe(evaluated(result.after).contextSha256);
    expect(evaluated(result.after).members).toHaveLength(4);
    expect(
      evaluated(result.after).members.find((member) => member.memberId === UNKNOWN),
    ).toMatchObject({ pool: 'EXCLUDED', exclusionReason: 'MEMBER_EMPLOYMENT_UNCONFIRMED' });
    expect(evaluated(result.after).opportunities).toEqual(
      [SEAT, OTHER].map((positionId) => ({
        positionId,
        evaluatedMemberCount: 3,
        eligibleMemberCount: 3,
      })),
    );
    expect(compared(result).affectedMemberIds).toEqual([]);
    expect(compared(result).eligibility.changeCount).toBe(0);
    expect(evaluated(result.after).selectionConsequences).toMatchObject({
      status: 'REQUIRES_SELECTION_CONTEXT',
    });
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

  it('uses unsaved required criteria for real eligibility counts and preserves successful and failed engine reasons', async () => {
    const candidate = requireCredential(structuredClone(content));
    const result = await impact(body(candidate, { trace: { memberId: TWO, positionId: SEAT } }));
    expect(
      evaluated(result.before).opportunities.find((position) => position.positionId === SEAT)
        ?.eligibleMemberCount,
    ).toBe(3);
    expect(
      evaluated(result.after).opportunities.find((position) => position.positionId === SEAT)
        ?.eligibleMemberCount,
    ).toBe(1);
    expect(compared(result).affectedMemberIds).toEqual([TWO, RETIRING]);
    expect(trace(result, 'before').eligible).toBe(true);
    expect(trace(result, 'after').eligible).toBe(false);
    expect(trace(result, 'after').reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ satisfied: true }),
        expect.objectContaining({ satisfied: false, label: expect.stringContaining(CREDENTIAL_A) }),
      ]),
    );
    expect(
      h.sqlite
        .prepare('SELECT required_criteria FROM position_rules WHERE position_id=?')
        .get(SEAT),
    ).toEqual({ required_criteria: '{"rank":["FF"],"credentials":[],"custom":[]}' });
  });

  it('matches the real scoring and comparison trace and changes priority using the unsaved points rule', async () => {
    const candidate = structuredClone(content);
    first(candidate.rules).pointsPreferenceJson = JSON.stringify({
      max: 7,
      items: [{ credential: CREDENTIAL_B, points: 7, requiresOpsPair: false }],
    });
    first(candidate.rules).tieBreakChainJson = '["points","rsc_seniority"]';
    const result = await impact(
      body(candidate, { trace: { memberId: TWO, positionId: SEAT, compareMemberId: ONE } }),
    );
    const canonical = canonicalBidDefinition(candidate);
    if (!canonical.ok) throw new Error(JSON.stringify(canonical));
    const rule = first(canonical.coverage.rules);
    const member = {
      employeeId: 'synthetic-impact-10002',
      firstName: 'Synthetic',
      lastName: 'Second',
      rank: 'FF' as const,
      rscSeniority: 2,
      rankSeniority: undefined,
      isProbationary: false,
      credentials: [{ name: CREDENTIAL_B }],
    };
    const own = evaluateEligibility(member, rule);
    const other = evaluateEligibility(
      { ...member, rscSeniority: 1, credentials: [{ name: CREDENTIAL_A }] },
      rule,
    );
    expect(trace(result, 'after')).toMatchObject({
      eligible: own.eligible,
      reasons: own.reasons,
      points: 7,
      breakdown: own.breakdown,
      priority: 1,
      comparison: compareWithTrace(
        { ...own, rscSeniority: 2, rankSeniority: Number.MAX_SAFE_INTEGER },
        { ...other, rscSeniority: 1, rankSeniority: Number.MAX_SAFE_INTEGER },
        rule.tieBreakChain,
      ),
    });
    expect(trace(result, 'before').priority).toBe(2);
    expect(compared(result).affectedMemberIds).toEqual([ONE, TWO]);
  });

  it('uses one Department capture for differing authored dates and reports removed participation separately from zero scores', async () => {
    const candidate = requireCredential(structuredClone(content));
    if (!candidate.settings || candidate.settings.v === 1)
      throw new Error('Synthetic dated settings missing');
    candidate.settings.credentialEvaluationOn = '2027-01-16';
    candidate.settings.personnelEvaluationOn = '2027-01-16';
    const query = vi.spyOn(h.env.DB, 'prepare');
    const result = await impact(
      body(candidate, { trace: { memberId: RETIRING, positionId: SEAT } }),
    );
    expect(query.mock.calls.filter(([sql]) => /from\s+"members"/i.test(sql))).toHaveLength(1);
    expect(evaluated(result.before).personnelEvaluationOn).toBe('2027-01-01');
    expect(evaluated(result.after).personnelEvaluationOn).toBe('2027-01-16');
    expect(evaluated(result.before).contextSha256).not.toBe(evaluated(result.after).contextSha256);
    expect(
      evaluated(result.after).opportunities.find((position) => position.positionId === SEAT)
        ?.eligibleMemberCount,
    ).toBe(0);
    expect(compared(result).eligibility.incomparable.removedMemberIds).toEqual([RETIRING]);
    expect(compared(result).poolChanges).toContainEqual(
      expect.objectContaining({
        memberId: RETIRING,
        after: expect.objectContaining({ exclusionReason: 'MEMBER_NOT_ACTIVE' }),
      }),
    );
    expect(result.trace?.after).toMatchObject({
      status: 'NOT_APPLICABLE',
      code: 'member_excluded_from_bid',
    });
    expect(result.trace?.after).not.toHaveProperty('points');
  });

  it('keeps stage order changes visible even when opportunity eligibility has not changed', async () => {
    await save(policy(structuredClone(content)));
    const candidate = structuredClone(content);
    alterPolicy(candidate, (value) => {
      for (const stage of value.stages) stage.order = 1 - stage.order;
    });
    const result = await impact(body(candidate));
    expect(compared(result).eligibility.changeCount).toBe(0);
    expect(evaluated(result.before).stageOrder.entries.map((entry) => entry.memberId)).toEqual([
      ONE,
      TWO,
      RETIRING,
    ]);
    expect(evaluated(result.after).stageOrder.entries.map((entry) => entry.memberId)).toEqual([
      TWO,
      RETIRING,
      ONE,
    ]);
    expect(compared(result).affectedMemberIds).toEqual([ONE, TWO, RETIRING]);
    expect(compared(result).stageChanges).toHaveLength(3);
  });

  it('counts changed stage opportunity applicability even when member order and scores are identical', async () => {
    await save(policy(structuredClone(content)));
    const candidate = structuredClone(content);
    alterPolicy(candidate, (value) => {
      first(value.stages).opportunityPositionIds = [OTHER];
    });
    const result = await impact(body(candidate, { trace: { memberId: ONE, positionId: SEAT } }));
    expect(evaluated(result.before).stageOrder.status).toBe('EVALUATED');
    expect(evaluated(result.after).stageOrder.status).toBe('EVALUATED');
    expect(trace(result, 'before').stage?.opportunityAllowed).toBe(true);
    expect(trace(result, 'after').stage?.opportunityAllowed).toBe(false);
    expect(compared(result).eligibility.changeCount).toBe(0);
    expect(compared(result).affectedMemberIds).toContain(ONE);
    expect(compared(result).stageOpportunityChanges).toEqual([
      { memberId: ONE, addedPositionIds: [OTHER], removedPositionIds: [SEAT] },
    ]);
  });

  it('keeps lower-level reasons available when a draft stage references an excluded participant', async () => {
    await save(policy(structuredClone(content)));
    const candidate = structuredClone(content);
    alterPolicy(candidate, (value) => {
      first(value.stages).memberIds.push(UNKNOWN);
    });
    const result = await impact(body(candidate, { trace: { memberId: ONE, positionId: SEAT } }));
    expect(evaluated(result.after).stageOrder).toMatchObject({
      status: 'BLOCKED',
      codes: expect.arrayContaining(['stage_member_reference_invalid']),
      entries: [],
    });
    expect(trace(result, 'after').reasons).toContainEqual(
      expect.objectContaining({ satisfied: true }),
    );
    expect(compared(result).stageChanges).toBeNull();
  });

  it('blocks only the candidate when an unsaved credential requirement refers to a pending dispute', async () => {
    h.sqlite.exec(`
      INSERT INTO targetsolutions_imports(id,filename,observed_on,source_row_count,unique_row_count,coverage_json,status,created_by,created_at)
        VALUES ('synthetic-impact-import','synthetic.csv','2027-01-01',1,1,'{}','reviewed','synthetic-editor',1);
      INSERT INTO targetsolutions_rows(id,import_id,row_number,source_json,member_id,credential_id,classification)
        VALUES ('synthetic-impact-dispute','synthetic-impact-import',1,'{"expiresOn":null}',10002,7002,'CONFLICT');
    `);
    await refreshCurrent();
    const result = await impact(
      body(requireCredential(structuredClone(content), CREDENTIAL_B), {
        trace: { memberId: TWO, positionId: SEAT },
      }),
    );
    expect(evaluated(result.before).opportunities).toHaveLength(2);
    expect(result.after).toEqual({
      status: 'BLOCKED',
      code: 'credential_import_dispute_requires_review',
      positionIds: [],
      tenureIssues: [],
    });
    expect(result.after).not.toHaveProperty('contextSha256');
    expect(result.after).not.toHaveProperty('opportunities');
    expect(result.after).not.toHaveProperty('members');
    expect(result.impactSha256).toBeNull();
    expect(result.comparison).toEqual({
      status: 'UNAVAILABLE',
      code: 'both_definitions_must_be_evaluable',
    });
    expect(result.trace?.after).toEqual({
      status: 'UNAVAILABLE',
      code: 'credential_import_dispute_requires_review',
    });
  });

  it.each(['before', 'after'] as const)(
    'does not manufacture a comparison hash or zero impact when %s is unconfigured',
    async (side) => {
      const complete = structuredClone(content);
      if (side === 'before') {
        const incomplete = structuredClone(content);
        incomplete.settings = null;
        await save(incomplete);
      }
      const candidate = side === 'before' ? complete : { ...content, settings: null };
      const result = await impact(body(candidate));
      expect(result[side]).toMatchObject({
        status: 'BLOCKED',
        code: 'bid_configuration_unconfigured',
      });
      expect(result.impactSha256).toBeNull();
      expect(result.comparison).toEqual({
        status: 'UNAVAILABLE',
        code: 'both_definitions_must_be_evaluable',
      });
      expect(result[side]).not.toHaveProperty('contextSha256');
      expect(result[side]).not.toHaveProperty('opportunities');
    },
  );

  it('reports added and removed opportunities as incomparable with explicit missing-side traces', async () => {
    const candidate = structuredClone(content);
    candidate.positions = candidate.positions.filter((position) => position.id !== OTHER);
    candidate.rules = candidate.rules.filter((rule) => rule.positionId !== OTHER);
    candidate.positions.push({ ...first(candidate.positions), id: 'synthetic-impact-added' });
    candidate.rules.push({ ...first(candidate.rules), positionId: 'synthetic-impact-added' });
    const result = await impact(body(candidate, { trace: { memberId: ONE, positionId: OTHER } }));
    expect(compared(result).eligibility.incomparable).toEqual({
      addedMemberIds: [],
      removedMemberIds: [],
      addedPositionIds: ['synthetic-impact-added'],
      removedPositionIds: [OTHER],
    });
    expect(compared(result).eligibility.changeCount).toBe(0);
    expect(compared(result).affectedMemberIds).toEqual([ONE, TWO, RETIRING]);
    expect(result.trace?.after).toEqual({
      status: 'UNAVAILABLE',
      code: 'position_not_in_definition',
    });
    expect(result.trace?.after).not.toHaveProperty('points');
  });

  it('exhausts every page across multiple opportunities with one stable impact identity and no skipped or repeated records', async () => {
    const insert = h.sqlite.prepare(
      `INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,employment_status,employment_status_effective_on,created_at,updated_at) VALUES (?,?,'Synthetic','Pagination','FF','FF',?,0,'active','2020-01-01',1,1)`,
    );
    for (let index = 0; index < 105; index++)
      insert.run(11000 + index, `synthetic-pagination-${index}`, 10 + index);
    await refreshCurrent();
    const candidate = requireCredential(structuredClone(content));
    for (const rule of candidate.rules)
      rule.requiredCriteriaJson = first(candidate.rules).requiredCriteriaJson;
    const initial = await impact(body(candidate));
    const page = compared(initial).eligibility;
    expect(page.changeCount).toBe(214);
    expect(page.changes).toHaveLength(100);
    expect(page.nextChangeOffset).toBe(100);
    expect(initial.impactSha256).toMatch(HASH);
    const changes = [...page.changes];
    let nextOffset = page.nextChangeOffset;
    const offsets: number[] = [];
    while (nextOffset !== null) {
      offsets.push(nextOffset);
      expect(offsets.length).toBeLessThan(4);
      const next = await impact(
        body(candidate, {
          changeOffset: nextOffset,
          expectedImpactSha256: initial.impactSha256 ?? undefined,
        }),
      );
      expect(next.impactSha256).toBe(initial.impactSha256);
      expect(compared(next).eligibility.changeCount).toBe(214);
      expect(compared(next).eligibility.changes).toHaveLength(nextOffset === 100 ? 100 : 14);
      expect(compared(next).affectedMemberIds).toEqual(compared(initial).affectedMemberIds);
      changes.push(...compared(next).eligibility.changes);
      nextOffset = compared(next).eligibility.nextChangeOffset;
    }
    expect(offsets).toEqual([100, 200]);
    expect(
      new Set(changes.map((row) => `${row.cause}:${row.positionId}:${row.memberId}`)).size,
    ).toBe(214);
    expect(
      changes.map(({ cause, positionId, memberId }) => ({ cause, positionId, memberId })),
    ).toEqual(
      [SEAT, OTHER].flatMap((positionId) =>
        [TWO, RETIRING, ...Array.from({ length: 105 }, (_, index) => 11000 + index)].map(
          (memberId) => ({ cause: 'POLICY', positionId, memberId }),
        ),
      ),
    );
    for (const changeOffset of [214, Number.MAX_SAFE_INTEGER]) {
      const exhausted = await impact(
        body(candidate, {
          changeOffset,
          expectedImpactSha256: initial.impactSha256 ?? undefined,
        }),
      );
      expect(exhausted.impactSha256).toBe(initial.impactSha256);
      expect(compared(exhausted).eligibility).toMatchObject({
        changeCount: 214,
        changes: [],
        nextChangeOffset: null,
      });
    }
    const drill = await impact(
      body(candidate, {
        expectedImpactSha256: initial.impactSha256 ?? undefined,
        trace: { memberId: TWO, positionId: SEAT },
      }),
    );
    expect(drill.impactSha256).toBe(initial.impactSha256);
    expect(trace(drill, 'after').eligible).toBe(false);
  });

  it('rejects an old current-head token rather than evaluating against a different saved baseline', async () => {
    const stale = body();
    await save();
    const response = await readonlyRequest(stale);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'bid_definition_or_source_changed' });
  });

  it('rejects trace/page reuse after unsaved content changes even when evidence is unchanged', async () => {
    const initial = await impact();
    const candidate = structuredClone(content);
    candidate.notes.bid = 'Synthetic new unsaved policy language';
    const response = await readonlyRequest(
      body(candidate, {
        expectedImpactSha256: initial.impactSha256 ?? undefined,
        trace: { memberId: ONE, positionId: SEAT },
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'bid_impact_context_changed' });
  });

  it('rejects trace/page reuse after actual Department evidence changes under the same saved head', async () => {
    await save();
    const initial = await impact();
    const fixedExpected = structuredClone(expected);
    h.sqlite.exec(`UPDATE members SET is_probationary=1 WHERE id=${ONE}`);
    const response = await readonlyRequest(
      body(content, {
        expectedImpactSha256: initial.impactSha256 ?? undefined,
        trace: { memberId: ONE, positionId: SEAT },
      }),
    );
    expect(expected).toEqual(fixedExpected);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'bid_impact_context_changed' });
  });

  it.each(['during capture', 'after both calculations'] as const)(
    'rejects a Department race %s and adds no writes of its own',
    async (when) => {
      await save();
      const input = body();
      let raced = false;
      let predicates = 0;
      let afterRace: Buffer | undefined;
      const original = h.env.DB.prepare.bind(h.env.DB);
      const mutate = () => {
        h.sqlite.exec(`UPDATE members SET is_probationary=1 WHERE id=${ONE}`);
        raced = true;
        afterRace = h.sqlite.serialize();
      };
      vi.spyOn(h.env.DB, 'prepare').mockImplementation((sql) => {
        const statement = original(sql);
        if (!raced && when === 'during capture' && /from\s+"members"/i.test(sql)) {
          const raw = statement.raw.bind(statement);
          vi.spyOn(statement, 'raw').mockImplementation(async <T = unknown[]>() => {
            const rows = await raw<T>();
            mutate();
            return rows;
          });
        }
        if (
          !raced &&
          when === 'after both calculations' &&
          sql.includes('WITH captured AS') &&
          ++predicates === 2
        ) {
          const all = statement.all.bind(statement);
          vi.spyOn(statement, 'all').mockImplementation(async <T>() => {
            const rows = await all<T>();
            mutate();
            return rows;
          });
        }
        return statement;
      });
      const response = await request(input);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: 'bid_definition_or_source_changed' });
      expect(raced).toBe(true);
      deepStrictEqual(h.sqlite.serialize(), afterRace);
    },
  );

  it('evaluates an explicit immutable restore candidate without restoring or inventing a new version', async () => {
    const original = await save();
    await save(requireCredential(structuredClone(content)));
    const result = await impact(
      body(content, {
        intent: { operation: 'restore', versionId: original },
        trace: { memberId: TWO, positionId: SEAT },
      }),
    );
    expect(result.source.kind).toBe('RESTORE_CANDIDATE');
    expect(trace(result, 'before').eligible).toBe(false);
    expect(trace(result, 'after').eligible).toBe(true);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_definition_versions').get()).toEqual({
      n: 2,
    });
  });

  it('rejects a real concurrent saved-head advance after evidence was captured', async () => {
    await save();
    const input = body();
    const next = structuredClone(content);
    next.notes.bid = 'Synthetic concurrent administrator saved this version';
    let raced = false;
    let afterRace: Buffer | undefined;
    const original = h.env.DB.prepare.bind(h.env.DB);
    vi.spyOn(h.env.DB, 'prepare').mockImplementation((sql) => {
      const statement = original(sql);
      if (!raced && /from\s+"members"/i.test(sql)) {
        const raw = statement.raw.bind(statement);
        vi.spyOn(statement, 'raw').mockImplementation(async <T = unknown[]>() => {
          const rows = await raw<T>();
          raced = true;
          const saved = await saveBidDefinition(h.env.DB, {
            year: YEAR,
            key: 'synthetic-concurrent-impact-save',
            actorSubject: 'synthetic-other-editor',
            actorId: TWO,
            expected,
            reason: 'Synthetic concurrent save during impact',
            intent: { operation: 'save', content: next },
          });
          if (!saved.ok) throw new Error(JSON.stringify(saved));
          afterRace = h.sqlite.serialize();
          return rows;
        });
      }
      return statement;
    });
    const response = await request(input);
    expect(raced).toBe(true);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'bid_definition_or_source_changed' });
    deepStrictEqual(h.sqlite.serialize(), afterRace);
    expect(h.sqlite.prepare('SELECT revision FROM bid_definition_heads').get()).toEqual({
      revision: 2,
    });
  });

  it('reports equal comparator results as shared priority without inventing an employee-ID tie-break', async () => {
    const candidate = structuredClone(content);
    first(candidate.rules).tieBreakChainJson = '["points"]';
    const result = await impact(
      body(candidate, { trace: { memberId: TWO, positionId: SEAT, compareMemberId: ONE } }),
    );
    expect(trace(result, 'before').priority).toBe(2);
    expect(trace(result, 'after')).toMatchObject({
      priority: 1,
      comparison: {
        result: 0,
        steps: [{ key: 'points', left: 0, right: 0, direction: 'HIGHER_FIRST', result: 0 }],
      },
    });
    expect(
      compared(result)
        .eligibility.changes.filter((row) => row.positionId === SEAT)
        .map((row) => ({ memberId: row.memberId, priority: row.after.priority })),
    ).toEqual([
      { memberId: TWO, priority: 1 },
      { memberId: RETIRING, priority: 1 },
    ]);
  });

  it('returns a non-applicable trace when an unsaved opportunity becomes explicitly reserved', async () => {
    const candidate = structuredClone(content);
    candidate.rules = candidate.rules.filter((rule) => rule.positionId !== SEAT);
    candidate.participation.push({
      positionId: SEAT,
      bidParticipation: 'RESERVED_NON_BIDDABLE',
      authoritativeSourceRef: 'Synthetic explicit reservation',
    });
    const result = await impact(body(candidate, { trace: { memberId: ONE, positionId: SEAT } }));
    expect(result.trace?.after).toMatchObject({
      status: 'NOT_APPLICABLE',
      code: 'position_not_biddable',
    });
    expect(result.trace?.after).not.toHaveProperty('points');
    expect(compared(result).eligibility.incomparable.removedPositionIds).toEqual([SEAT]);
    expect(evaluated(result.after).opportunities.map((position) => position.positionId)).toEqual([
      OTHER,
    ]);
  });

  it('does not confuse a Live calculation with permission to create or publish a Live Bid', async () => {
    const v2 = await impact(body(content, { mode: 'live' }));
    expect(v2.after).toMatchObject({
      status: 'BLOCKED',
      code: 'bid_configuration_live_policy_required',
    });
    const candidate = policy(structuredClone(content));
    const result = await impact(body(candidate, { mode: 'live' }));
    expect(evaluated(result.after).stageOrder.status).toBe('EVALUATED');
    expect(result.mode).toBe('live');
    expect(result).not.toHaveProperty('wouldAllowCreateLive');
    expect(result).not.toHaveProperty('published');
    expect(h.sqlite.prepare('SELECT status FROM rule_books').all()).toEqual([{ status: 'draft' }]);
  });

  it('reports an invalid execution actor without suppressing independently valid stage order or eligibility', async () => {
    await save(policy(structuredClone(content)));
    const candidate = structuredClone(content);
    alterPolicy(candidate, (value) => {
      first(value.actionPermissions).actorMemberIds = [999999];
    });
    const result = await impact(body(candidate, { trace: { memberId: ONE, positionId: SEAT } }));
    expect(evaluated(result.before).executionReferenceErrors).toEqual([]);
    expect(evaluated(result.after).executionReferenceErrors).toEqual([
      'action_actor_reference_invalid',
    ]);
    expect(evaluated(result.after).stageOrder).toEqual(evaluated(result.before).stageOrder);
    expect(evaluated(result.after).stageOrder.status).toBe('EVALUATED');
    expect(compared(result).stageChanges).toEqual([]);
    expect(compared(result).unavailableAreas).not.toContain('STAGE_ORDER');
    expect(trace(result, 'after').eligible).toBe(true);
    expect(result).not.toHaveProperty('wouldAllowCreateLive');
  });

  it('reports specialty applicability and mode changes even when candidates and their points are unchanged', async () => {
    await save(specialty(structuredClone(content)));
    const candidate = structuredClone(content);
    alterPolicy(candidate, (value) => {
      const item = first(value.annualOperations?.specialties ?? []);
      item.mode = 'INTERRUPTING';
      item.opportunityPositionIds = [OTHER];
    });
    const result = await impact(body(candidate));
    const original = first(evaluated(result.before).specialties);
    const changed = first(evaluated(result.after).specialties);
    expect(original).toMatchObject({
      status: 'EVALUATED',
      mode: 'PRIORITY_ONLY',
      opportunityPositionIds: [SEAT],
    });
    expect(original.candidates).toEqual([{ memberId: TWO, points: 5, priority: 1 }]);
    expect(changed.candidates).toEqual(original.candidates);
    expect(changed).toMatchObject({
      status: 'EVALUATED',
      mode: 'INTERRUPTING',
      opportunityPositionIds: [OTHER],
    });
    expect(compared(result).eligibility.changeCount).toBe(0);
    expect(compared(result).specialtyChanges).toEqual([
      {
        id: 'synthetic-priority',
        status: 'EVALUATED',
        addedPositionIds: [OTHER],
        removedPositionIds: [SEAT],
        modeChanged: true,
        changes: [{ memberId: TWO, before: original.candidates[0], after: changed.candidates[0] }],
      },
    ]);
    expect(compared(result).affectedMemberIds).toEqual([TWO]);
  });

  it.each([
    ['credential', 'specialty_credential_reference_invalid'],
    ['qualification', 'specialty_qualification_reference_invalid'],
  ] as const)(
    'does not report a valid empty specialty result when its %s reference is unavailable',
    async (kind, code) => {
      await save(specialty(structuredClone(content)));
      const candidate = structuredClone(content);
      alterPolicy(candidate, (value) => {
        const item = first(value.annualOperations?.specialties ?? []);
        if (kind === 'credential')
          item.requiredCredentialNames = ['Synthetic nonexistent credential'];
        else item.requiredSpecialtyCodes = ['SYNTHETIC-NONEXISTENT'];
      });
      const result = await impact(body(candidate));
      expect(first(evaluated(result.before).specialties).candidates).toHaveLength(1);
      expect(first(evaluated(result.after).specialties)).toMatchObject({
        status: 'BLOCKED',
        code,
        candidates: [],
      });
      expect(evaluated(result.after).executionReferenceErrors).toContain(code);
      expect(evaluated(result.after).stageOrder.status).toBe('EVALUATED');
      expect(first(compared(result).specialtyChanges)).toMatchObject({
        status: 'UNAVAILABLE',
        changes: [],
      });
      expect(compared(result).unavailableAreas).toContain('SPECIALTY:synthetic-priority');
      expect(compared(result).stageChanges).toEqual([]);
    },
  );

  it('distinguishes a valid specialty with no qualified members from an unavailable specialty evaluation', async () => {
    await save(specialty(structuredClone(content)));
    const candidate = structuredClone(content);
    alterPolicy(candidate, (value) => {
      first(value.annualOperations?.specialties ?? []).requiredCredentialNames = [
        CREDENTIAL_A,
        CREDENTIAL_B,
      ];
    });
    const result = await impact(body(candidate));
    expect(first(evaluated(result.after).specialties)).toMatchObject({
      status: 'EVALUATED',
      code: null,
      candidates: [],
    });
    expect(evaluated(result.after).executionReferenceErrors).toEqual([]);
    expect(first(compared(result).specialtyChanges)).toMatchObject({
      status: 'EVALUATED',
      changes: [{ memberId: TWO, after: null }],
    });
    expect(compared(result).unavailableAreas).toEqual([]);
    expect(compared(result).affectedMemberIds).toEqual([TWO]);
  });

  it.each([
    ['missing authentication', null, 401],
    ['member role', 'member', 403],
    ['stale step-up', 'stale', 401],
  ] as const)('enforces %s on the actual impact preview route', async (_label, mode, status) => {
    const authorization =
      mode === null ? null : await token(mode === 'member' ? 'member' : 'admin', mode !== 'stale');
    const response = await readonlyRequest(body(), { authorization });
    expect(response.status).toBe(status);
    if (mode === 'stale')
      expect(await response.json()).toMatchObject({ error: 'step_up_required' });
  });

  it.each(['2023', '2101', '2027.1', '02027'])(
    'rejects invalid year %s before evaluation',
    async (year) => {
      const response = await readonlyRequest(body(), { year });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_bid_year' });
    },
  );

  it('rejects a candidate with a different year without any impact identity', async () => {
    const response = await readonlyRequest(body({ ...content, bidYear: 2028 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'bid_definition_year_mismatch' });
  });

  it.each([
    ['actor override', { actorId: TWO }],
    ['missing mode', { mode: undefined }],
    ['unknown mode', { mode: 'publish' }],
    ['negative page offset', { changeOffset: -1 }],
    ['fractional page offset', { changeOffset: 0.5 }],
    ['unsafe page offset', { changeOffset: Number.MAX_SAFE_INTEGER + 1 }],
    ['malformed impact digest', { expectedImpactSha256: 'short' }],
    ['malformed trace member', { trace: { memberId: 0, positionId: SEAT } }],
    ['unknown trace field', { trace: { memberId: ONE, positionId: SEAT, actorId: TWO } }],
    ['unknown intent', { intent: { operation: 'publish' } }],
  ] as const)('rejects %s as an invalid strict request', async (_label, override) => {
    const response = await readonlyRequest({ ...body(), ...override });
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty('impactSha256');
  });

  it.each(
    (['title', 'question', 'decision', 'sourceRef'] as const).flatMap((field) =>
      (
        [
          ['blank', ''],
          ['whitespace', '    '],
          ['short', 'abc'],
        ] as const
      ).map(([label, value]) => ({ field, label, value })),
    ),
  )(
    'rejects a resolved source decision with $label $field through impact',
    async ({ field, value }) => {
      const candidate = structuredClone(content);
      candidate.sourceDecisions = [
        {
          issueId: 'synthetic-source-authority',
          title: 'Synthetic policy question',
          question: 'Which source controls this synthetic decision?',
          area: 'annual-policy',
          status: 'RESOLVED',
          decision: 'Use the reviewed synthetic source interpretation.',
          sourceRef: 'Synthetic reviewed source document, section 4',
          effectiveOn: '2027-01-01',
          [field]: value,
        },
      ];
      const result = await impact(body(candidate));
      expect(result).toMatchObject({
        valid: true,
        before: { status: 'EVALUATED' },
        after: { status: 'BLOCKED', code: 'policy_source_decision_required' },
        comparison: { status: 'UNAVAILABLE' },
        impactSha256: null,
      });
      expect(result.after).not.toHaveProperty('opportunities');
    },
  );

  it('keeps an incomplete OPEN source decision blocked in impact while retaining the saved baseline evaluation', async () => {
    const candidate = structuredClone(content);
    candidate.sourceDecisions = [
      {
        issueId: 'synthetic-open-source',
        title: '',
        question: '',
        area: 'annual-policy',
        status: 'OPEN',
        decision: '',
        sourceRef: '',
        effectiveOn: '2027-01-01',
      },
    ];
    const result = await impact(body(candidate));
    expect(result.before.status).toBe('EVALUATED');
    expect(result.after).toMatchObject({
      status: 'BLOCKED',
      code: 'policy_source_decision_required',
    });
    expect(result.comparison.status).toBe('UNAVAILABLE');
    expect(result.impactSha256).toBeNull();
  });

  it('reports invalid unsaved content as invalid rather than returning a made-up zero impact', async () => {
    const response = await readonlyRequest(
      body({ ...content, positions: [{ ...first(content.positions), unknownPolicy: true }] }),
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ valid: false, issues: expect.any(Array) });
    expect(result).not.toHaveProperty('impactSha256');
    expect(result).not.toHaveProperty('comparison');
  });
  it('rejects malformed JSON without entering the impact evaluator', async () => {
    const response = await readonlyRequest('{broken', { raw: true });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_body' });
  });
});
