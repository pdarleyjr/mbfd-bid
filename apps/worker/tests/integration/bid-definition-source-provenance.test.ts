import { deepStrictEqual } from 'node:assert';
import { AnnualRuleProfilesSchema, FrozenLiveBidPolicySchema } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileAnnualRules } from '../../src/lib/annual-rule-compiler.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { decodePositionRule } from '../../src/lib/position-rule.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const YEAR = 2027;
const BOOK = '2027.1';
const AS_OF = '2027-01-01';
const SEAT = 'synthetic-provenance-seat';
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

function profiles() {
  return AnnualRuleProfilesSchema.parse([
    {
      id: 'department',
      name: 'Synthetic department source',
      sourceRef: 'synthetic-only:department-policy',
      scope: { kind: 'department' },
      requirements: { credentials: ['Compiled prerequisite'], custom: [] },
      scoring: { v: 1, total: [], so: [], mo: [] },
      tieBreakChain: ['rsc_seniority'],
    },
    {
      id: 'seat',
      name: 'Synthetic seat source',
      sourceRef: 'synthetic-only:seat-policy',
      scope: { kind: 'position', positionId: SEAT },
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

function executionPolicy() {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-provenance-policy',
    stages: [
      {
        id: 'FIREFIGHTER',
        label: 'Synthetic Firefighter stage',
        order: 0,
        memberIds: [10001],
        opportunityPositionIds: [SEAT],
        kind: 'FIREFIGHTER',
      },
    ],
    dispositions: ['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'].map(
      (disposition) => ({
        disposition,
        advances: true,
        returns: false,
        returnStageId: null,
        retainsLaterSelectionRights: false,
        terminal: false,
        requiresReason: true,
        requiresEvidence: false,
        contactPolicyReference: null,
      }),
    ),
    actionPermissions: [
      'record_selection',
      'amend_selection',
      'skip_defer',
      'mark_unreachable',
      'force',
      'resolve_tie',
      'alter_order',
      'pause_resume',
      'approve_transition',
      'approve_final_results',
      'publish',
    ].map((action) => ({ action, actorMemberIds: [10001] })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
  });
}

describe('Bid source capture provenance and control consistency', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic template');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',4,'Synthetic source');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',3,'{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-01","personnelEvaluationOn":"2027-01-01"}');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('${SEAT}','2027.1','A','7','Combat','Engine 7','FF','Synthetic firefighter');
      INSERT INTO annual_plan_reviews (bid_year,effective_on,source_policy_text,created_at)
        VALUES (2027,'2027-01-01','Synthetic planning source',1);
    `);
    h.sqlite
      .prepare(`INSERT INTO position_rules
        (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain,notes)
        VALUES (?,?,?,?,?,?,?)`)
      .run(
        BOOK,
        SEAT,
        BOOK,
        JSON.stringify(ADVANCED.requiredCriteria),
        JSON.stringify(ADVANCED.pointsPreference),
        JSON.stringify(ADVANCED.tieBreakChain),
        'Direct advanced authoring preserved after compilation',
      );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  function seedProfiles(ruleRevision = 3) {
    const inputs = profiles();
    const compilation = compileAnnualRules(
      [{ id: SEAT, rank: 'FF', station: '7', shift: 'A' }],
      inputs,
      BOOK,
    );
    expect(compilation.ok).toBe(true);
    h.sqlite
      .prepare(`INSERT INTO annual_rule_profile_revisions
        (bid_year,revision,rule_revision,profiles_json,compiled_json,actor_subject,reason,created_at)
        VALUES (2027,1,?,?,?,'synthetic-reviewer','Synthetic compilation evidence',1)`)
      .run(ruleRevision, JSON.stringify(inputs), JSON.stringify(compilation.compiled));
    return { inputs, compilation };
  }

  function seedPolicy(documentPolicy: unknown = executionPolicy()) {
    const configured = executionPolicy();
    h.sqlite
      .prepare(`INSERT INTO annual_bid_policy_documents
        (id,rule_book_version,effective_year,revision,status,policy_text,execution_policy_json,created_at,updated_at)
        VALUES ('synthetic-document','2027.1',2027,1,'DRAFT','Synthetic source policy text',?,1,1)`)
      .run(JSON.stringify(documentPolicy));
    h.sqlite
      .prepare('UPDATE bid_years SET annual_policy_document_id=?,config_json=? WHERE year=2027')
      .run(
        'synthetic-document',
        JSON.stringify({
          v: 3,
          expectedDurationDays: 2,
          turnTimerSeconds: 180,
          credentialEvaluationOn: AS_OF,
          personnelEvaluationOn: AS_OF,
          livePolicy: configured,
        }),
      );
    return configured;
  }

  async function readOnlyCapture() {
    const before = h.sqlite.serialize();
    const result = await captureBidDefinitionSource(h.env.DB, YEAR);
    deepStrictEqual(h.sqlite.serialize(), before);
    return result;
  }

  function revision() {
    return h.sqlite.prepare('SELECT revision FROM annual_source_revision WHERE id=1').get();
  }

  it('retains profile inputs, compiled provenance and stale reconciliation without replacing advanced final rules', async () => {
    const { inputs, compilation } = seedProfiles();
    const result = await readOnlyCapture();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.origin).toMatchObject({
      profileRevision: 1,
      profileRuleRevision: 3,
      ruleBookRevision: 4,
    });
    expect(result.content.authoring?.profiles).toEqual(inputs);
    expect(result.content.authoring?.reconciliation).toBe('RULES_CHANGED_AFTER_COMPILATION');
    expect(result.content.authoring?.compiled[0]?.provenance).toEqual(
      compilation.compiled[0]?.provenance,
    );
    const final = result.content.rules[0];
    const compiled = result.content.authoring?.compiled[0]?.rule;
    expect(JSON.parse(compiled?.requiredCriteriaJson ?? 'null')).toEqual(
      compilation.compiled[0]?.rule.requiredCriteria,
    );
    expect(JSON.parse(compiled?.pointsPreferenceJson ?? 'null')).toEqual(
      compilation.compiled[0]?.rule.pointsPreference,
    );
    expect(JSON.parse(compiled?.tieBreakChainJson ?? 'null')).toEqual(
      compilation.compiled[0]?.rule.tieBreakChain,
    );
    const original = decodePositionRule({
      positionId: SEAT,
      ruleBookVersion: BOOK,
      requiredCriteriaJson: JSON.stringify(ADVANCED.requiredCriteria),
      pointsPreferenceJson: JSON.stringify(ADVANCED.pointsPreference),
      tieBreakChainJson: JSON.stringify(ADVANCED.tieBreakChain),
    });
    if (!original.ok)
      throw new Error('Synthetic advanced rule does not satisfy the existing decoder');
    expect(final?.notes).toBe('Direct advanced authoring preserved after compilation');
    expect(JSON.parse(final?.requiredCriteriaJson ?? 'null')).toEqual(
      original.rule.requiredCriteria,
    );
    expect(JSON.parse(final?.pointsPreferenceJson ?? 'null')).toEqual(
      original.rule.pointsPreference,
    );
    expect(JSON.parse(final?.tieBreakChainJson ?? 'null')).toEqual(original.rule.tieBreakChain);
    expect(final?.requiredCriteriaJson).not.toBe(compiled?.requiredCriteriaJson);
    expect(decodePositionRule({ ...final, ruleBookVersion: BOOK }).ok).toBe(true);
    expect(result.coverage.valid).toBe(true);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('keeps a matching recorded compilation distinct from final authoring content', async () => {
    seedProfiles(4);
    const result = await readOnlyCapture();
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.content.authoring?.reconciliation).toBe('MATCHES_CAPTURED_RULE_REVISION');
    expect(result.content.authoring?.compiled[0]?.rule).not.toEqual(result.content.rules[0]);
  });

  it('retains equivalent document/settings policy despite JSON object-key ordering', async () => {
    const configured = seedPolicy(Object.fromEntries(Object.entries(executionPolicy()).reverse()));
    const result = await readOnlyCapture();
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.content.policy?.policyText).toBe('Synthetic source policy text');
    if (result.content.settings?.v !== 3 || !result.content.policy)
      throw new Error('Captured policy lost its complete V3 settings');
    const captured = result.content.policy.executionPolicy;
    expect(captured).toEqual(result.content.settings.livePolicy);
    const { actionPermissions, dispositions, ...otherPolicy } = captured;
    const {
      actionPermissions: originalGrants,
      dispositions: originalDispositions,
      ...otherOriginal
    } = configured;
    expect(otherPolicy).toEqual(otherOriginal);
    expect(new Map(actionPermissions.map((entry) => [entry.action, entry]))).toEqual(
      new Map(originalGrants.map((entry) => [entry.action, entry])),
    );
    expect(new Map(dispositions.map((entry) => [entry.disposition, entry]))).toEqual(
      new Map(originalDispositions.map((entry) => [entry.disposition, entry])),
    );
    expect(result.origin).toMatchObject({
      policyDocumentId: 'synthetic-document',
      policyDocumentRevision: 1,
      policyDocumentStatus: 'DRAFT',
    });
  });

  it('rejects a document whose executable policy differs from configured settings', async () => {
    seedPolicy({ ...executionPolicy(), policyRevision: 'synthetic-different-policy' });
    const result = await readOnlyCapture();
    expect(result).toMatchObject({
      ok: false,
      error: 'bid_definition_source_invalid',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'policy_settings_mismatch' }),
      ]),
    });
  });

  it.each([
    'book',
    'template',
    'profile-replacement',
    'profile-append',
    'document-pointer',
  ] as const)(
    'rejects %s drift even when the global source revision does not advance',
    async (kind) => {
      seedProfiles();
      seedPolicy();
      const sourceRevision = revision();
      const originalPrepare = h.env.DB.prepare.bind(h.env.DB);
      let changed = false;
      let afterConcurrentWrite: ReturnType<TestD1['sqlite']['serialize']> | undefined;
      vi.spyOn(h.env.DB, 'prepare').mockImplementation((sql) => {
        if (!changed && sql.includes('FROM position_rules')) {
          changed = true;
          if (kind === 'book')
            h.sqlite.exec("UPDATE rule_books SET revision=revision+1 WHERE version='2027.1'");
          if (kind === 'template')
            h.sqlite.exec(
              "UPDATE position_templates SET notes='Synthetic concurrent template' WHERE version='2027.1'",
            );
          if (kind === 'profile-replacement')
            h.sqlite.exec(`INSERT OR REPLACE INTO annual_rule_profile_revisions
            SELECT bid_year,revision,rule_revision,json_set(profiles_json,'$[0].sourceRef','synthetic-only:concurrent-profile'),compiled_json,actor_subject,reason,created_at FROM annual_rule_profile_revisions`);
          if (kind === 'profile-append')
            h.sqlite.exec(`INSERT INTO annual_rule_profile_revisions
            SELECT bid_year,revision+1,rule_revision,profiles_json,compiled_json,actor_subject,reason,created_at FROM annual_rule_profile_revisions`);
          if (kind === 'document-pointer')
            h.sqlite.exec(`INSERT INTO annual_bid_policy_documents
            SELECT 'synthetic-next-document',rule_book_version,effective_year,revision+1,status,'Synthetic concurrent document',execution_policy_json,created_by,created_at,updated_at,published_by,published_at,supersedes_document_id FROM annual_bid_policy_documents;
            UPDATE bid_years SET annual_policy_document_id='synthetic-next-document' WHERE year=2027`);
          afterConcurrentWrite = h.sqlite.serialize();
        }
        return originalPrepare(sql);
      });
      expect(await captureBidDefinitionSource(h.env.DB, YEAR)).toMatchObject({
        ok: false,
        error: 'bid_definition_source_changed',
      });
      expect(changed).toBe(true);
      expect(revision()).toEqual(sourceRevision);
      deepStrictEqual(h.sqlite.serialize(), afterConcurrentWrite);
    },
  );

  it.each([
    'missing-book',
    'foreign-book',
    'missing-template',
    'foreign-template',
    'missing-document',
    'foreign-document',
  ] as const)('rejects %s designated source rather than synthesizing it', async (kind) => {
    h.sqlite.exec(`INSERT INTO rule_books (version,effective_year,status) VALUES ('2028.1',2028,'draft');
        INSERT INTO position_templates (version,effective_year) VALUES ('2028.1',2028);
        INSERT INTO bid_years (year,status) VALUES (2028,'configuring')`);
    if (kind === 'missing-book' || kind === 'missing-template' || kind === 'missing-document') {
      // Deliberately corrupt only this isolated fixture to exercise recovery of broken references.
      h.sqlite.pragma('foreign_keys = OFF');
    }
    if (kind === 'missing-book')
      h.sqlite.exec("UPDATE bid_years SET rule_book_version='2027.absent' WHERE year=2027");
    if (kind === 'foreign-book')
      h.sqlite.exec("UPDATE bid_years SET rule_book_version='2028.1' WHERE year=2027");
    if (kind === 'missing-template')
      h.sqlite.exec("UPDATE bid_years SET position_template_version='2027.absent' WHERE year=2027");
    if (kind === 'foreign-template')
      h.sqlite.exec("UPDATE bid_years SET position_template_version='2028.1' WHERE year=2027");
    if (kind === 'missing-document')
      h.sqlite.exec(
        "UPDATE bid_years SET annual_policy_document_id='absent-document' WHERE year=2027",
      );
    if (kind === 'foreign-document') {
      h.sqlite
        .prepare(`INSERT INTO annual_bid_policy_documents
          (id,rule_book_version,effective_year,revision,status,policy_text,execution_policy_json,created_at,updated_at)
          VALUES ('foreign-document','2028.1',2028,1,'DRAFT','Synthetic foreign policy',?,1,1)`)
        .run(JSON.stringify(executionPolicy()));
      h.sqlite.exec(
        "UPDATE bid_years SET annual_policy_document_id='foreign-document' WHERE year=2027",
      );
    }
    h.sqlite.pragma('foreign_keys = ON');
    const result = await readOnlyCapture();
    const code = kind.endsWith('book')
      ? 'designated_book_invalid'
      : kind.endsWith('template')
        ? 'designated_template_invalid'
        : 'designated_document_invalid';
    expect(result).toMatchObject({
      ok: false,
      error: 'bid_definition_source_invalid',
      issues: expect.arrayContaining([expect.objectContaining({ code })]),
    });
  });

  it('retains a selected source session with unavailable snapshot provenance without claiming approval', async () => {
    h.sqlite.exec(`INSERT INTO bid_sessions (id,bid_year,is_mock,started_at,current_phase)
      VALUES ('synthetic-source-without-snapshot',2027,1,1,'config');
      UPDATE annual_plan_reviews SET source_session_id='synthetic-source-without-snapshot' WHERE bid_year=2027`);
    const result = await readOnlyCapture();
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.content.planning?.sourceSessionId).toBe('synthetic-source-without-snapshot');
    expect(result.origin.selectedSourceSnapshotSha256).toBeNull();
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('rejects compiled provenance that references a profile absent from the recorded inputs', async () => {
    seedProfiles();
    h.sqlite.exec(`INSERT OR REPLACE INTO annual_rule_profile_revisions
      SELECT bid_year,revision,rule_revision,profiles_json,json_set(compiled_json,'$[0].provenance.scoring',json('["absent-profile"]')),actor_subject,reason,created_at FROM annual_rule_profile_revisions`);
    expect(await readOnlyCapture()).toMatchObject({
      ok: false,
      error: 'bid_definition_source_invalid',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'unknown_profile' })]),
    });
  });
});
