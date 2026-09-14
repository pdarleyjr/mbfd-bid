import { deepStrictEqual } from 'node:assert';
import { BidDispositionSchema, FrozenLiveBidPolicySchema, LiveBidActionSchema } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalBidDefinition } from '../../src/lib/bid-definition-content.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const OWNED = '2097.501';
const FREE = '2098.501';
const SEAT = 'synthetic-owned-rowid-seat';
const FREE_SEAT = 'synthetic-free-rowid-seat';
const TABLES = [
  'bid_definition_versions',
  'position_templates',
  'rule_books',
  'positions',
  'rule_book_position_participation',
  'position_staffing_bindings',
  'annual_bid_policy_documents',
  'annual_rule_profile_revisions',
  'bid_source_decisions',
] as const;
type Table = (typeof TABLES)[number];
type Row = Record<string, string | number | null>;

// A rowid replacement of these parent records also changes their public FK
// identity. Disable only that separate protection during their seal probes;
// otherwise a generic FK failure could mask the missing immutable-row trigger.
const FK_MASKED = new Set<Table>([
  'bid_definition_versions',
  'position_templates',
  'rule_books',
  'positions',
  'annual_bid_policy_documents',
]);

describe.each([false, true])('Bid rowid seals with recursive_triggers=%s', (recursive) => {
  let h: TestD1;
  let ownedRows: Record<Table, Row>;
  let incomingRows: Record<Table, Row>;

  function insert(table: Table, row: Row, rowid?: number, replace = false) {
    const record: Row = rowid === undefined ? row : { rowid, ...row };
    const columns = Object.keys(record);
    return h.sqlite
      .prepare(
        `INSERT ${replace ? 'OR REPLACE ' : ''}INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      )
      .run(...Object.values(record));
  }

  function storageId(table: Table, row: Row) {
    const where = Object.keys(row)
      .map((column) => `${column} IS ?`)
      .join(' AND ');
    const found = h.sqlite
      .prepare(`SELECT rowid AS storageId FROM ${table} WHERE ${where}`)
      .get(...Object.values(row)) as { storageId: number } | undefined;
    if (!found) throw new Error(`Missing synthetic ${table} row`);
    return found.storageId;
  }

  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.pragma(`recursive_triggers = ${recursive ? 'ON' : 'OFF'}`);
    h.sqlite.exec(`
      INSERT INTO bid_years(year,status) VALUES (2097,'configuring'),(2098,'configuring');
      INSERT INTO annual_plan_reviews(bid_year,effective_on,created_at) VALUES (2097,'2097-01-01',1);
      INSERT INTO staffing_positions(id,stable_slot_key,review_status,created_at,updated_at)
        VALUES ('synthetic-rowid-staffing','synthetic-rowid-staffing','approved',1,1);
    `);
    const position = (id: string, template: string): Row => ({
      id,
      template_version: template,
      shift: 'A',
      station: '7',
      division: 'Combat',
      unit: 'Synthetic Engine',
      rank_required: 'FF',
      position_name: 'Synthetic Firefighter',
      is_floating: 0,
      is_vacant_by_design: 0,
      is_excluded_from_count: 0,
    });
    const policy = FrozenLiveBidPolicySchema.parse({
      v: 1,
      policyRevision: 'synthetic-rowid-policy',
      stages: [
        {
          id: 'synthetic-stage',
          label: 'Synthetic stage',
          order: 0,
          memberIds: [10001],
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
    });
    const rule = {
      positionId: SEAT,
      requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
      pointsPreferenceJson: '{"max":0,"items":[]}',
      tieBreakChainJson: '["rsc_seniority"]',
      notes: null,
    };
    const content = canonicalBidDefinition({
      v: 1,
      bidYear: 2097,
      settings: {
        v: 3,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2097-01-01',
        livePolicy: policy,
      },
      notes: { bid: null, positions: null },
      policy: { policyText: 'Synthetic rowid policy source', executionPolicy: policy },
      planning: null,
      authoring: null,
      positions: [
        {
          id: SEAT,
          shift: 'A',
          station: '7',
          division: 'Combat',
          unit: 'Synthetic Engine',
          rankRequired: 'FF',
          positionName: 'Synthetic Firefighter',
          isFloating: false,
          isVacantByDesign: false,
          isExcludedFromCount: false,
        },
      ],
      rules: [rule],
      participation: [
        {
          positionId: SEAT,
          bidParticipation: 'BIDDABLE',
          authoritativeSourceRef: 'Synthetic participation source',
        },
      ],
      staffingBindings: [
        {
          positionId: SEAT,
          staffingPositionId: 'synthetic-rowid-staffing',
          authoritativeSourceRef: 'Synthetic staffing source',
          reviewStatus: 'approved',
        },
      ],
      sourceDecisions: [],
    });
    if (!content.ok) throw new Error(JSON.stringify(content.issues));
    const freeContent = canonicalBidDefinition({
      ...content.content,
      bidYear: 2098,
      settings: {
        v: 2,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2098-01-01',
      },
      policy: null,
      positions: content.content.positions.map((row) => ({ ...row, id: FREE_SEAT })),
      rules: [],
      participation: [],
      staffingBindings: [],
    });
    if (!freeContent.ok) throw new Error(JSON.stringify(freeContent.issues));
    const version = (
      id: string,
      year: number,
      alias: string,
      documentId: string | null,
      serialized: string,
      sha256: string,
    ): Row => ({
      id,
      bid_year: year,
      version_number: 1,
      schema_version: 1,
      content_json: serialized,
      content_sha256: sha256,
      origin_json: '{}',
      rule_book_version: alias,
      rule_book_revision: 0,
      position_template_version: alias,
      policy_document_id: documentId,
      predecessor_id: null,
      restored_from_id: null,
      actor_subject: 'synthetic-rowid-reviewer',
      reason: 'Synthetic rowid seal evidence',
      created_at: 1,
    });
    const profile = [
      {
        id: 'synthetic-profile',
        name: 'Synthetic profile',
        sourceRef: 'synthetic:rowid',
        scope: { kind: 'department' },
        requirements: { credentials: [], custom: [] },
        scoring: { v: 1, total: [], so: [], mo: [] },
        tieBreakChain: ['rsc_seniority'],
      },
    ];
    ownedRows = {
      position_templates: { version: OWNED, effective_year: 2097, notes: null },
      rule_books: {
        version: OWNED,
        effective_year: 2097,
        status: 'draft',
        revision: 0,
        notes: null,
      },
      positions: position(SEAT, OWNED),
      rule_book_position_participation: {
        rule_book_version: OWNED,
        position_id: SEAT,
        template_version: OWNED,
        bid_participation: 'BIDDABLE',
        authoritative_source_ref: 'Synthetic participation source',
        created_at: 1,
      },
      position_staffing_bindings: {
        position_id: SEAT,
        template_version: OWNED,
        staffing_position_id: 'synthetic-rowid-staffing',
        authoritative_source_ref: 'Synthetic staffing source',
        review_status: 'approved',
        created_at: 1,
      },
      annual_bid_policy_documents: {
        id: 'synthetic-owned-rowid-policy',
        rule_book_version: OWNED,
        effective_year: 2097,
        revision: 1,
        status: 'DRAFT',
        policy_text: 'Synthetic rowid policy source',
        execution_policy_json: JSON.stringify(content.content.policy?.executionPolicy),
        created_by: null,
        created_at: 1,
        updated_at: 1,
      },
      bid_definition_versions: version(
        'synthetic-owned-rowid-version',
        2097,
        OWNED,
        'synthetic-owned-rowid-policy',
        content.serialized,
        content.sha256,
      ),
      annual_rule_profile_revisions: {
        bid_year: 2097,
        revision: 1,
        rule_revision: 0,
        profiles_json: JSON.stringify(profile),
        compiled_json: '[]',
        actor_subject: 'synthetic-rowid-reviewer',
        reason: 'Synthetic rowid profile source',
        created_at: 1,
      },
      bid_source_decisions: {
        bid_year: 2097,
        issue_id: 'synthetic-owned-issue',
        revision: 1,
        title: 'Synthetic rowid decision',
        question: 'Synthetic rowid source question',
        area: 'rules',
        status: 'RESOLVED',
        decision: 'Synthetic explicit source decision',
        source_ref: 'synthetic:rowid',
        effective_on: '2097-01-01',
        actor_subject: 'synthetic-rowid-reviewer',
        created_at: 1,
      },
    };
    // Populate valid material before its version becomes a permanent owner.
    for (const table of TABLES.filter((table) => table !== 'bid_definition_versions')) {
      insert(table, ownedRows[table]);
    }
    h.sqlite
      .prepare(`INSERT INTO position_rules(rule_book_version,position_id,template_version,
      required_criteria,points_preference,tie_break_chain,notes) VALUES (?,?,?,?,?,?,?)`)
      .run(
        OWNED,
        SEAT,
        OWNED,
        rule.requiredCriteriaJson,
        rule.pointsPreferenceJson,
        rule.tieBreakChainJson,
        null,
      );
    insert('bid_definition_versions', ownedRows.bid_definition_versions);

    // Alternate parents are valid and have no version owner. Replacement
    // attempts use distinct public keys so only the storage-row collision is relevant.
    insert('position_templates', { version: FREE, effective_year: 2098, notes: null });
    insert('rule_books', {
      version: FREE,
      effective_year: 2098,
      status: 'draft',
      revision: 0,
      notes: null,
    });
    insert('positions', position(FREE_SEAT, FREE));
    incomingRows = {
      position_templates: { version: '2098.777', effective_year: 2098, notes: null },
      rule_books: {
        version: '2098.777',
        effective_year: 2098,
        status: 'draft',
        revision: 0,
        notes: null,
      },
      positions: position('synthetic-incoming-rowid-seat', FREE),
      rule_book_position_participation: {
        ...ownedRows.rule_book_position_participation,
        rule_book_version: FREE,
        position_id: FREE_SEAT,
        template_version: FREE,
      },
      position_staffing_bindings: {
        ...ownedRows.position_staffing_bindings,
        position_id: FREE_SEAT,
        template_version: FREE,
      },
      annual_bid_policy_documents: {
        ...ownedRows.annual_bid_policy_documents,
        id: 'synthetic-incoming-rowid-policy',
        rule_book_version: FREE,
        effective_year: 2098,
      },
      bid_definition_versions: version(
        'synthetic-incoming-rowid-version',
        2098,
        FREE,
        null,
        freeContent.serialized,
        freeContent.sha256,
      ),
      annual_rule_profile_revisions: { ...ownedRows.annual_rule_profile_revisions, revision: 2 },
      bid_source_decisions: {
        ...ownedRows.bid_source_decisions,
        issue_id: 'synthetic-incoming-issue',
      },
    };
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    const sealed = await loadBidDefinitionVersion(h.env.DB, 2097, 'synthetic-owned-rowid-version');
    expect(sealed.ok, JSON.stringify(sealed)).toBe(true);
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it.each(TABLES)(
    'rejects INSERT OR REPLACE into an occupied %s rowid with different public keys',
    (table) => {
      const target = storageId(table, ownedRows[table]);
      // Positive control: the identical candidate is a legal append at a fresh
      // rowid, including version lineage and document/FK constraints.
      h.sqlite.exec('SAVEPOINT candidate_validity');
      expect(() => insert(table, incomingRows[table], 900000)).not.toThrow();
      h.sqlite.exec('ROLLBACK TO candidate_validity; RELEASE candidate_validity');
      if (FK_MASKED.has(table)) h.sqlite.pragma('foreign_keys = OFF');
      const before = h.sqlite.serialize();
      expect(() => insert(table, incomingRows[table], target, true)).toThrow(/immutable/);
      deepStrictEqual(h.sqlite.serialize(), before);
      expect(storageId(table, ownedRows[table])).toBe(target);
    },
  );

  it.each(TABLES)(
    'rejects UPDATE OR REPLACE moving a separate %s row onto an owned rowid',
    (table) => {
      const target = storageId(table, ownedRows[table]);
      insert(table, incomingRows[table], 900000);
      const incoming = storageId(table, incomingRows[table]);
      expect(incoming).not.toBe(target);
      expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
      if (FK_MASKED.has(table)) h.sqlite.pragma('foreign_keys = OFF');
      const before = h.sqlite.serialize();
      const expectedError =
        table === 'bid_source_decisions'
          ? /immutable|source decisions require a new revision/
          : /immutable/;
      expect(() =>
        h.sqlite
          .prepare(`UPDATE OR REPLACE ${table} SET rowid=? WHERE rowid=?`)
          .run(target, incoming),
      ).toThrow(expectedError);
      deepStrictEqual(h.sqlite.serialize(), before);
      expect(storageId(table, ownedRows[table])).toBe(target);
      expect(storageId(table, incomingRows[table])).toBe(incoming);
    },
  );
});
