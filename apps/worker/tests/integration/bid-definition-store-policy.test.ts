import { deepStrictEqual } from 'node:assert';
import {
  AnnualRuleProfilesSchema,
  type BidDefinitionContent,
  BidDispositionSchema,
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileAnnualRules } from '../../src/lib/annual-rule-compiler.js';
import { canonicalBidDefinition } from '../../src/lib/bid-definition-content.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import {
  type SaveBidDefinitionInput,
  saveBidDefinition,
} from '../../src/lib/bid-definition-store.js';
import {
  loadBidDefinitionHead,
  loadBidDefinitionVersion,
} from '../../src/lib/bid-definition-version.js';
import { decodePositionRule } from '../../src/lib/position-rule.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

// All identities, source decisions and policy language are explicitly synthetic.
// The fixture exercises editing/storage integrity, not annual policy approval.
const YEAR = 2027;
const BOOK = '2027.1';
const AS_OF = '2027-01-01';
const SEATS = ['synthetic-policy-seat-a', 'synthetic-policy-seat-b', 'synthetic-policy-seat-c'];
const POLICY_TEXT = 'Synthetic annual language.\nPreserve the exact ordered scoring inputs.';
const ADVANCED = {
  requiredCriteria: {
    rank: ['FF'],
    credentials: ['Direct prerequisite'],
    anyOfCredentials: [['Direct Rescue A', 'Direct Rescue B']],
    service: [{ serviceCode: 'SYNTHETIC_SERVICE', minimumMonths: 12 }],
    custom: ['non_probationary'],
  },
  pointsPreference: {
    max: 7,
    items: [
      { credential: 'Direct credential B', points: 5 },
      { credential: 'Direct credential A', points: 4 },
    ],
  },
  tieBreakChain: ['points', 'rank_seniority', 'rsc_seniority'],
};

function executionPolicy(): FrozenLiveBidPolicy {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-full-store-policy',
    stages: [
      {
        id: 'first',
        label: 'First synthetic stage',
        order: 0,
        memberIds: [10001, 10002],
        opportunityPositionIds: SEATS.slice(0, 2),
        kind: 'FIREFIGHTER',
      },
      {
        id: 'second',
        label: 'Second synthetic stage',
        order: 1,
        memberIds: [10003],
        opportunityPositionIds: SEATS.slice(2),
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
      actorMemberIds: [10001, 10002],
    })),
    specialtyCatalogReference: 'synthetic:specialty-source',
    aDayPolicyReference: 'synthetic:a-day-source',
    transitionPolicyReference: 'synthetic:transition-source',
    publicationPolicyReference: 'synthetic:publication-source',
    annualOperations: {
      v: 1,
      stageOrder: ['first', 'second'],
      requiredTopologyPositionIds: SEATS,
      specialties: [
        {
          id: 'synthetic-priority',
          label: 'Synthetic priority',
          mode: 'PRIORITY_ONLY',
          opportunityPositionIds: SEATS.slice(0, 1),
          requiredCredentialNames: ['Direct prerequisite'],
          requiredSpecialtyCodes: ['SYNTHETIC'],
          points: [
            { credentialName: 'Direct credential B', value: 5 },
            { credentialName: 'Direct credential A', value: 4 },
          ],
          tieBreakChain: ['POINTS', 'RANK_SENIORITY', 'RSC_SENIORITY'],
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
    },
  });
}

function profileInputs() {
  return AnnualRuleProfilesSchema.parse([
    {
      id: 'department',
      name: 'Synthetic department profile',
      sourceRef: 'synthetic:department-policy',
      scope: { kind: 'department' },
      requirements: { credentials: ['Compiled prerequisite'], custom: [] },
      scoring: { v: 1, total: [], so: [], mo: [] },
      tieBreakChain: ['rsc_seniority'],
    },
    {
      id: 'seat',
      name: 'Synthetic seat profile',
      sourceRef: 'synthetic:seat-policy',
      scope: { kind: 'position', positionId: SEATS[0] },
      requirements: { credentials: ['Compiled specialty'], custom: [] },
      scoring: {
        v: 1,
        total: [
          {
            id: 'training',
            cap: 3,
            items: [
              { credential: 'Compiled training', alternatives: [], requiresAll: [], points: 5 },
            ],
          },
        ],
        so: [],
        mo: [],
      },
      tieBreakChain: ['points', 'rsc_seniority'],
    },
  ]);
}

const materialTables = [
  'bid_definition_versions',
  'bid_definition_heads',
  'position_templates',
  'rule_books',
  'positions',
  'position_rules',
  'rule_book_position_participation',
  'position_staffing_bindings',
  'annual_bid_policy_documents',
  'annual_rule_profile_revisions',
  'annual_plan_reviews',
  'bid_source_decisions',
  'bid_years',
  'bid_sessions',
  'bid_session_policy_snapshots',
  'annual_source_revision',
] as const;

describe('Bid version store with full policy and captured authoring evidence', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
        VALUES (10001,'synthetic-policy-editor','Synthetic','Editor','FF','FF',1,1,1),
        (10002,'synthetic-policy-second','Synthetic','Second','FF','FF',2,1,1),
        (10003,'synthetic-policy-third','Synthetic','Third','FF','FF',3,1,1);
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic topology notes');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',4,'Synthetic Bid notes');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',3,'{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-01","personnelEvaluationOn":"2027-01-01"}');
      INSERT INTO bid_sessions (id,bid_year,started_at,current_phase,is_mock)
        VALUES ('synthetic-planning-source',2027,1,'complete',1);
      INSERT INTO bid_session_policy_snapshots (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at)
        VALUES ('synthetic-planning-source','2027.1','2027.1',NULL,'{"v":1,"ruleBookVersion":"2027.1","positionTemplateVersion":"2027.1","capturedAtMs":1,"members":[]}',1);
      INSERT INTO annual_plan_reviews (bid_year,effective_on,source_session_id,revision,source_policy_text,created_at)
        VALUES (2027,'2027-01-01','synthetic-planning-source',5,'Synthetic planning source language',1);
      INSERT INTO bid_source_decisions (bid_year,issue_id,revision,title,question,area,status,decision,source_ref,effective_on,actor_subject,created_at)
        VALUES (2027,'synthetic-issue-a',1,'Original question','Which source?','rules','OPEN','','synthetic:old','2027-01-01','synthetic-editor',1),
        (2027,'synthetic-issue-a',2,'Latest question','Which source?','rules','RESOLVED','Use the explicit direct rule','synthetic:latest','2027-01-01','synthetic-editor',2),
        (2027,'synthetic-issue-b',1,'Second question','What remains open?','annual-policy','OPEN','','synthetic:second','2027-01-01','synthetic-editor',3);
    `);
    for (const seat of SEATS) {
      h.sqlite
        .prepare(`INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
          VALUES (?,'2027.1','A','7','Combat','Synthetic Engine 7','FF','Synthetic firefighter')`)
        .run(seat);
      h.sqlite
        .prepare(`INSERT INTO position_rules
          (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain,notes)
          VALUES ('2027.1',?,'2027.1',?,?,?,'Direct advanced rule remains authoritative')`)
        .run(
          seat,
          JSON.stringify(ADVANCED.requiredCriteria),
          JSON.stringify(ADVANCED.pointsPreference),
          JSON.stringify(ADVANCED.tieBreakChain),
        );
      h.sqlite
        .prepare(`INSERT INTO rule_book_position_participation
          (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
          VALUES ('2027.1',?,'2027.1','BIDDABLE','synthetic:participation',1)`)
        .run(seat);
      h.sqlite
        .prepare(`INSERT INTO staffing_positions (id,stable_slot_key,review_status,created_at,updated_at)
          VALUES (?,?,'approved',1,1)`)
        .run(`staffing:${seat}`, `slot:${seat}`);
      h.sqlite
        .prepare(`INSERT INTO position_staffing_bindings
          (position_id,template_version,staffing_position_id,authoritative_source_ref,review_status,created_at)
          VALUES (?,'2027.1',?,'synthetic:binding','approved',1)`)
        .run(seat, `staffing:${seat}`);
    }
    const profiles = profileInputs();
    const compilation = compileAnnualRules(
      SEATS.map((id) => ({ id, rank: 'FF', station: '7', shift: 'A' })),
      profiles,
      BOOK,
    );
    if (!compilation.ok) throw new Error('Synthetic authoring fixture did not compile');
    for (const revision of [1, 2]) {
      h.sqlite
        .prepare(`INSERT INTO annual_rule_profile_revisions
          (bid_year,revision,rule_revision,profiles_json,compiled_json,actor_subject,reason,created_at)
          VALUES (2027,?,3,?,?,'synthetic-editor','Synthetic compilation source',?)`)
        .run(revision, JSON.stringify(profiles), JSON.stringify(compilation.compiled), revision);
    }
    const policy = executionPolicy();
    h.sqlite
      .prepare(`INSERT INTO annual_bid_policy_documents
        (id,rule_book_version,effective_year,revision,status,policy_text,execution_policy_json,created_by,created_at,updated_at)
        VALUES ('synthetic-policy-document','2027.1',2027,1,'DRAFT',?,?,10001,1,1)`)
      .run(POLICY_TEXT, JSON.stringify(Object.fromEntries(Object.entries(policy).reverse())));
    h.sqlite
      .prepare('UPDATE bid_years SET annual_policy_document_id=?,config_json=? WHERE year=2027')
      .run(
        'synthetic-policy-document',
        JSON.stringify({
          v: 3,
          expectedDurationDays: 2,
          turnTimerSeconds: 180,
          credentialEvaluationOn: AS_OF,
          personnelEvaluationOn: AS_OF,
          livePolicy: policy,
        }),
      );
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  async function adoption(key = 'synthetic-policy-adoption') {
    const bytes = h.sqlite.serialize();
    const captured = await captureBidDefinitionSource(h.env.DB, YEAR);
    deepStrictEqual(h.sqlite.serialize(), bytes);
    if (!captured.ok) throw new Error(JSON.stringify(captured));
    const input: SaveBidDefinitionInput = {
      year: YEAR,
      key,
      actorSubject: 'synthetic-editor',
      actorId: 10001,
      expected: { kind: 'legacy', sourceToken: captured.sourceToken },
      reason: 'Adopt explicit synthetic full policy source',
      intent: { operation: 'save', content: captured.content },
    };
    return { captured, input };
  }

  async function save(input: SaveBidDefinitionInput) {
    const result = await saveBidDefinition(h.env.DB, input);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result;
  }

  function materialRows() {
    return Object.fromEntries(
      materialTables.map((table) => [table, h.sqlite.prepare(`SELECT * FROM ${table}`).all()]),
    );
  }

  it('adopts and loads complete policy, authoring, planning, latest decisions and bindings', async () => {
    const { captured, input } = await adoption();
    const originalYear = h.sqlite.prepare('SELECT * FROM bid_years').all();
    const originalSnapshots = h.sqlite.prepare('SELECT * FROM bid_session_policy_snapshots').all();
    const batch = vi.spyOn(h.env.DB, 'batch');
    const saved = await save(input);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]?.[0]).toHaveLength(11);
    const loaded = await loadBidDefinitionVersion(h.env.DB, YEAR, String(saved.response.versionId));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    expect(loaded.content).toEqual(captured.content);
    expect(loaded.serialized).toBe(captured.serialized);
    expect(loaded.sha256).toBe(captured.sha256);
    expect(loaded.origin.legacy).toMatchObject({
      profileRevision: 2,
      profileRuleRevision: 3,
      ruleBookRevision: 4,
      planningRevision: 5,
      sourceDecisionRevisions: expect.arrayContaining([
        { issueId: 'synthetic-issue-a', revision: 2 },
        { issueId: 'synthetic-issue-b', revision: 1 },
      ]),
    });
    expect(loaded.content.authoring?.profiles).toEqual(profileInputs());
    expect(loaded.content.authoring?.reconciliation).toBe('RULES_CHANGED_AFTER_COMPILATION');
    expect(loaded.content.authoring?.compiled).toHaveLength(3);
    expect(loaded.content.authoring?.compiled[0]?.rule.requiredCriteriaJson).not.toBe(
      loaded.content.rules[0]?.requiredCriteriaJson,
    );
    const direct = decodePositionRule({
      positionId: SEATS[0],
      ruleBookVersion: BOOK,
      requiredCriteriaJson: JSON.stringify(ADVANCED.requiredCriteria),
      pointsPreferenceJson: JSON.stringify(ADVANCED.pointsPreference),
      tieBreakChainJson: JSON.stringify(ADVANCED.tieBreakChain),
    });
    if (!direct.ok) throw new Error('Synthetic direct rule is invalid');
    expect(JSON.parse(loaded.content.rules[0]?.requiredCriteriaJson ?? 'null')).toEqual(
      direct.rule.requiredCriteria,
    );
    expect(JSON.parse(loaded.content.rules[0]?.pointsPreferenceJson ?? 'null')).toEqual(
      direct.rule.pointsPreference,
    );
    expect(JSON.parse(loaded.content.rules[0]?.tieBreakChainJson ?? 'null')).toEqual(
      ADVANCED.tieBreakChain,
    );
    expect(loaded.content.planning).toEqual({
      effectiveOn: AS_OF,
      sourceSessionId: 'synthetic-planning-source',
      sourcePolicyText: 'Synthetic planning source language',
    });
    expect(loaded.content.sourceDecisions).toHaveLength(2);
    expect(loaded.content.sourceDecisions[0]).toMatchObject({
      issueId: 'synthetic-issue-a',
      title: 'Latest question',
      status: 'RESOLVED',
      decision: 'Use the explicit direct rule',
      sourceRef: 'synthetic:latest',
    });
    expect(loaded.content.staffingBindings).toEqual(
      SEATS.map((positionId) => ({
        positionId,
        staffingPositionId: `staffing:${positionId}`,
        authoritativeSourceRef: 'synthetic:binding',
        reviewStatus: 'approved',
      })),
    );
    if (loaded.content.settings?.v !== 3) throw new Error('V3 settings missing');
    expect(loaded.content.policy?.executionPolicy).toEqual(loaded.content.settings.livePolicy);
    expect(loaded.content.policy?.policyText).toBe(POLICY_TEXT);
    const document = h.sqlite
      .prepare('SELECT * FROM annual_bid_policy_documents WHERE id=?')
      .get(loaded.row.policy_document_id) as Record<string, unknown>;
    expect(document).toMatchObject({
      rule_book_version: loaded.row.rule_book_version,
      effective_year: YEAR,
      policy_text: POLICY_TEXT,
      status: 'DRAFT',
      created_by: 10001,
    });
    expect(document.id).not.toBe('synthetic-policy-document');
    expect(JSON.parse(String(document.execution_policy_json))).toEqual(
      loaded.content.settings.livePolicy,
    );
    expect(h.sqlite.prepare('SELECT * FROM bid_years').all()).toEqual(originalYear);
    expect(h.sqlite.prepare('SELECT * FROM bid_session_policy_snapshots').all()).toEqual(
      originalSnapshots,
    );
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(Array.from({ length: 11 }, (_, index) => index))(
    'rolls back the complete policy bundle when statement %i fails',
    async (index) => {
      const { input } = await adoption();
      const bytes = h.sqlite.serialize();
      const batch = vi.spyOn(h.env.DB, 'batch');
      h.failNextBatchAt(index);
      expect(await saveBidDefinition(h.env.DB, input)).toMatchObject({ ok: false });
      expect(batch.mock.calls[0]?.[0]).toHaveLength(11);
      deepStrictEqual(h.sqlite.serialize(), bytes);
      expect(
        h.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_configuration_receipts').get(),
      ).toEqual({ n: 0 });
      expect(
        h.sqlite.prepare('SELECT COUNT(*) AS n FROM annual_bid_policy_documents').get(),
      ).toEqual({ n: 1 });
      expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    },
  );

  it('records a canonical policy-set no-op without creating another document or material bundle', async () => {
    const { input } = await adoption();
    const first = await save(input);
    const loaded = await loadBidDefinitionVersion(h.env.DB, YEAR, String(first.response.versionId));
    const head = await loadBidDefinitionHead(h.env.DB, YEAR);
    if (!loaded.ok || !head) throw new Error('Initial synthetic version missing');
    const content: BidDefinitionContent = structuredClone(loaded.content);
    if (content.settings?.v !== 3 || !content.policy)
      throw new Error('Synthetic V3 policy missing');
    for (const policy of [content.settings.livePolicy, content.policy.executionPolicy]) {
      policy.stages.reverse();
      for (const stage of policy.stages) {
        stage.memberIds.reverse();
        stage.opportunityPositionIds.reverse();
      }
      policy.dispositions.reverse();
      policy.actionPermissions.reverse();
      for (const grant of policy.actionPermissions) grant.actorMemberIds.reverse();
      policy.annualOperations?.requiredTopologyPositionIds.reverse();
    }
    content.authoring?.profiles.reverse();
    content.authoring?.compiled.reverse();
    content.sourceDecisions.reverse();
    content.staffingBindings.reverse();
    const canonical = canonicalBidDefinition(content);
    expect(canonical).toMatchObject({ ok: true, sha256: loaded.sha256 });
    const before = materialRows();
    const batch = vi.spyOn(h.env.DB, 'batch');
    const result = await save({
      ...input,
      key: 'synthetic-policy-no-op',
      expected: {
        kind: 'version',
        versionId: head.versionId,
        revision: head.revision,
        sha256: loaded.sha256,
      },
      intent: { operation: 'save', content },
    });
    expect(result.response).toMatchObject({ changed: false, versionId: first.response.versionId });
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);
    expect(materialRows()).toEqual(before);
    expect(
      h.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_configuration_receipts').get(),
    ).toEqual({ n: 2 });
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['document-actor', 'staffing-binding'] as const)(
    'rolls back an actual invalid %s foreign key without a committed receipt',
    async (kind) => {
      const { input, captured } = await adoption();
      if (kind === 'document-actor') input.actorId = 99999;
      if (kind === 'staffing-binding') {
        input.intent = {
          operation: 'save',
          content: {
            ...captured.content,
            staffingBindings: captured.content.staffingBindings.map((binding, index) => ({
              ...binding,
              staffingPositionId:
                index === 0 ? 'synthetic-absent-staffing' : binding.staffingPositionId,
            })),
          },
        };
      }
      const bytes = h.sqlite.serialize();
      const originalBatch = h.env.DB.batch.bind(h.env.DB);
      let batchFailure: unknown;
      const batch = vi.spyOn(h.env.DB, 'batch').mockImplementationOnce(async (statements) => {
        try {
          return await originalBatch(statements);
        } catch (error) {
          batchFailure = error;
          throw error;
        }
      });
      expect(await saveBidDefinition(h.env.DB, input)).toMatchObject({ ok: false });
      expect(batch.mock.calls[0]?.[0]).toHaveLength(11);
      expect(batchFailure).toMatchObject({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' });
      deepStrictEqual(h.sqlite.serialize(), bytes);
      expect(
        h.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_configuration_receipts').get(),
      ).toEqual({ n: 0 });
      expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    },
  );
});
