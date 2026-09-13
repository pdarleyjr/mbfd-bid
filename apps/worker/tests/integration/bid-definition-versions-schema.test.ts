import { deepStrictEqual } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalBidDefinition } from '../../src/lib/bid-definition-content.js';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);
const MIGRATION = '0059_bid_definition_versions.sql';
const BOOK = '2027.101';
const FREE_BOOK = '2027.102';
const SEAT = 'synthetic-version-seat';
const ACTOR = 10001;
const NOW = Date.UTC(2026, 8, 12, 12);

function migrate(sqlite: Database.Database, includeVersion = true) {
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    if (file > MIGRATION || (!includeVersion && file === MIGRATION)) continue;
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  }
  sqlite.pragma('foreign_keys = ON');
}

function policy() {
  return {
    v: 1,
    policyRevision: 'synthetic-storage-policy',
    stages: [
      {
        id: 'FF',
        label: 'Synthetic Firefighter',
        order: 0,
        memberIds: [ACTOR],
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
      'create_live_session',
      'approve_transition',
      'approve_final_results',
      'publish',
    ].map((action) => ({ action, actorMemberIds: [ACTOR] })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
  };
}

function seedReferences(sqlite: Database.Database) {
  sqlite
    .prepare(`INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at)
    VALUES (?,'synthetic-version-actor','Synthetic','Reviewer','CHIEF','EXCLUDED',1,0,?,?)`)
    .run(ACTOR, NOW, NOW);
  sqlite.exec(`INSERT OR IGNORE INTO bid_years (year,status) VALUES (2027,'configuring'),(2028,'configuring');
    INSERT INTO staffing_positions (id,stable_slot_key,review_status,active_from,created_at,updated_at)
    VALUES ('synthetic-staffing-seat','SYNTHETIC/VERSION/SEAT','approved','2027-01-01',1,1)`);
}

function material(sqlite: Database.Database, alias = BOOK, year = 2027) {
  sqlite
    .prepare(
      "INSERT INTO rule_books (version,effective_year,status,revision) VALUES (?,?,'draft',0)",
    )
    .run(alias, year);
  sqlite
    .prepare('INSERT INTO position_templates (version,effective_year) VALUES (?,?)')
    .run(alias, year);
  sqlite
    .prepare(`INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
    VALUES (?,?,'A','7','Combat','Engine 7','FF','Synthetic firefighter')`)
    .run(SEAT, alias);
  const rule = {
    positionId: SEAT,
    requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
    pointsPreferenceJson: '{"max":0,"items":[]}',
    tieBreakChainJson: '["rsc_seniority"]',
    notes: null,
  };
  sqlite
    .prepare(`INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
    VALUES (?,?,?,?,?,?)`)
    .run(
      alias,
      SEAT,
      alias,
      rule.requiredCriteriaJson,
      rule.pointsPreferenceJson,
      rule.tieBreakChainJson,
    );
  sqlite
    .prepare(`INSERT INTO rule_book_position_participation (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
    VALUES (?,?,?,'BIDDABLE','Synthetic reviewed opportunity',?)`)
    .run(alias, SEAT, alias, NOW);
  sqlite
    .prepare(`INSERT INTO position_staffing_bindings (position_id,template_version,staffing_position_id,authoritative_source_ref,review_status,created_at)
    VALUES (?,?,'synthetic-staffing-seat','Synthetic reviewed binding','approved',?)`)
    .run(SEAT, alias, NOW);
  const documentId = `synthetic-document-${alias}`;
  sqlite
    .prepare(`INSERT INTO annual_bid_policy_documents (id,rule_book_version,effective_year,revision,status,policy_text,execution_policy_json,created_by,created_at,updated_at)
    VALUES (?,?,?,1,'DRAFT','Synthetic source policy',?,?,?,?)`)
    .run(documentId, alias, year, JSON.stringify(policy()), ACTOR, NOW, NOW);
  const content = canonicalBidDefinition({
    v: 1,
    bidYear: year,
    settings: {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      personnelEvaluationOn: '2027-01-01',
      livePolicy: policy(),
    },
    notes: { bid: null, positions: null },
    policy: { policyText: 'Synthetic source policy', executionPolicy: policy() },
    planning: null,
    authoring: null,
    positions: [
      {
        id: SEAT,
        shift: 'A',
        station: '7',
        division: 'Combat',
        unit: 'Engine 7',
        rankRequired: 'FF',
        positionName: 'Synthetic firefighter',
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
        authoritativeSourceRef: 'Synthetic reviewed opportunity',
      },
    ],
    staffingBindings: [
      {
        positionId: SEAT,
        staffingPositionId: 'synthetic-staffing-seat',
        authoritativeSourceRef: 'Synthetic reviewed binding',
        reviewStatus: 'approved',
      },
    ],
    sourceDecisions: [],
  });
  if (!content.ok) throw new Error(JSON.stringify(content.issues));
  return { alias, year, documentId, content };
}

type Material = ReturnType<typeof material>;
function insertVersion(
  sqlite: Database.Database,
  source: Material,
  overrides: Record<string, unknown> = {},
  verb = 'INSERT',
) {
  const row = {
    id: 'version-1',
    bid_year: source.year,
    version_number: 1,
    schema_version: 1,
    content_json: source.content.serialized,
    content_sha256: source.content.sha256,
    origin_json: '{}',
    rule_book_version: source.alias,
    rule_book_revision: 0,
    position_template_version: source.alias,
    policy_document_id: source.documentId,
    predecessor_id: null,
    restored_from_id: null,
    actor_subject: String(ACTOR),
    reason: 'Synthetic reviewed version',
    created_at: NOW,
    ...overrides,
  };
  return sqlite
    .prepare(
      `${verb} INTO bid_definition_versions (${Object.keys(row).join(',')}) VALUES (${Object.keys(
        row,
      )
        .map(() => '?')
        .join(',')})`,
    )
    .run(...Object.values(row));
}

describe('Bid immutable versions storage migration', () => {
  let sqlite: Database.Database;
  let owned: Material;
  beforeEach(() => {
    sqlite = new Database(':memory:');
    migrate(sqlite);
    seedReferences(sqlite);
    owned = material(sqlite);
  });
  afterEach(() => sqlite.close());

  function seal() {
    insertVersion(sqlite, owned);
    sqlite.exec(
      "INSERT INTO bid_definition_heads (bid_year,version_id,revision) VALUES (2027,'version-1',1)",
    );
  }
  function rejectUnchanged(write: () => unknown, message?: RegExp) {
    const before = sqlite.serialize();
    expect(write).toThrow(message);
    deepStrictEqual(sqlite.serialize(), before);
  }

  it('uses real referenced rows, immutable successors and repeated-content restore with a guarded head', () => {
    seal();
    const second = material(sqlite, FREE_BOOK);
    insertVersion(sqlite, second, {
      id: 'version-2',
      version_number: 2,
      predecessor_id: 'version-1',
      restored_from_id: 'version-1',
    });
    const stale = sqlite.prepare(
      "UPDATE bid_definition_heads SET version_id='version-2',revision=2 WHERE bid_year=2027 AND version_id='wrong-head' AND revision=1",
    );
    const before = sqlite.serialize();
    expect(stale.run().changes).toBe(0);
    deepStrictEqual(sqlite.serialize(), before);
    expect(
      sqlite
        .prepare(
          "UPDATE bid_definition_heads SET version_id='version-2',revision=2 WHERE bid_year=2027 AND version_id='version-1' AND revision=1",
        )
        .run().changes,
    ).toBe(1);
    expect(
      sqlite
        .prepare(
          'SELECT COUNT(DISTINCT content_sha256) AS hashes,COUNT(*) AS versions FROM bid_definition_versions',
        )
        .get(),
    ).toEqual({ hashes: 1, versions: 2 });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    rejectUnchanged(() =>
      sqlite.exec(
        "UPDATE positions SET position_name='Changed old version' WHERE template_version='2027.101'",
      ),
    );
  });

  it.each([
    ['missing v', { bidYear: 2027 }],
    ['null v', { v: null, bidYear: 2027 }],
    ['missing year', { v: 1 }],
    ['null year', { v: 1, bidYear: null }],
    ['wrong v type', { v: '1', bidYear: 2027 }],
    ['wrong year type', { v: 1, bidYear: '2027' }],
    ['wrong year', { v: 1, bidYear: 2028 }],
    ['wrong v', { v: 2, bidYear: 2027 }],
  ])('rejects %s in content identity paths', (_label, content) => {
    rejectUnchanged(() => insertVersion(sqlite, owned, { content_json: JSON.stringify(content) }));
  });

  it.each([
    ['fractional ordinal', { version_number: 1.5 }],
    ['zero ordinal', { version_number: 0 }],
    ['negative revision', { rule_book_revision: -1 }],
    ['unsupported schema', { schema_version: 2 }],
    ['bad hash alphabet', { content_sha256: 'z'.repeat(64) }],
    ['short hash', { content_sha256: 'a'.repeat(63) }],
    ['array origin', { origin_json: '[]' }],
    ['invalid origin', { origin_json: '{' }],
  ])('rejects %s scalar storage metadata', (_label, changes) => {
    rejectUnchanged(() => insertVersion(sqlite, owned, changes));
  });

  it('rejects deleting an immutable version even before any head references it', () => {
    insertVersion(sqlite, owned);
    rejectUnchanged(
      () => sqlite.exec("DELETE FROM bid_definition_versions WHERE id='version-1'"),
      /bid version is immutable/,
    );
  });

  it.each([
    "INSERT INTO bid_definition_heads VALUES (2028,'version-1',1)",
    "INSERT INTO bid_definition_heads VALUES (2027,'absent-version',1)",
    "INSERT INTO bid_definition_heads VALUES (2027,'version-1',2)",
  ])('rejects invalid initial head: %s', (statement) => {
    insertVersion(sqlite, owned);
    rejectUnchanged(() => sqlite.exec(statement), /initial bid head is invalid/);
  });

  it.each([
    'foreign-predecessor',
    'foreign-restore',
    'self-predecessor',
    'self-restore',
    'skipped-ordinal',
    'missing-predecessor',
  ] as const)('rejects %s lineage', (kind) => {
    seal();
    const second = material(sqlite, FREE_BOOK);
    const foreign = material(sqlite, '2028.101', 2028);
    insertVersion(sqlite, foreign, { id: 'foreign-version' });
    const changes: Record<string, unknown> = {
      id: 'version-2',
      version_number: 2,
      predecessor_id: 'version-1',
    };
    if (kind === 'foreign-predecessor') changes.predecessor_id = 'foreign-version';
    if (kind === 'foreign-restore') changes.restored_from_id = 'foreign-version';
    if (kind === 'self-predecessor') changes.predecessor_id = 'version-2';
    if (kind === 'self-restore') changes.restored_from_id = 'version-2';
    if (kind === 'skipped-ordinal') changes.version_number = 3;
    if (kind === 'missing-predecessor') changes.predecessor_id = null;
    rejectUnchanged(() => insertVersion(sqlite, second, changes));
  });

  it.each([
    'update-version',
    'delete-version',
    'replace-version',
    'replace-head',
    'delete-head',
    'same-version',
    'skip-head-revision',
    'move-head-year',
  ] as const)('rejects %s identity mutation', (kind) => {
    seal();
    const second = material(sqlite, FREE_BOOK);
    insertVersion(sqlite, second, {
      id: 'version-2',
      version_number: 2,
      predecessor_id: 'version-1',
    });
    const statements = {
      'update-version':
        "UPDATE bid_definition_versions SET reason='Different reason' WHERE id='version-1'",
      'delete-version': "DELETE FROM bid_definition_versions WHERE id='version-1'",
      'replace-version':
        "INSERT OR REPLACE INTO bid_definition_versions SELECT * FROM bid_definition_versions WHERE id='version-1'",
      'replace-head': "INSERT OR REPLACE INTO bid_definition_heads VALUES (2027,'version-2',2)",
      'delete-head': 'DELETE FROM bid_definition_heads WHERE bid_year=2027',
      'same-version': 'UPDATE bid_definition_heads SET revision=2 WHERE bid_year=2027',
      'skip-head-revision':
        "UPDATE bid_definition_heads SET version_id='version-2',revision=3 WHERE bid_year=2027",
      'move-head-year':
        "UPDATE bid_definition_heads SET bid_year=2028,version_id='version-2',revision=2 WHERE bid_year=2027",
    };
    rejectUnchanged(() => sqlite.exec(statements[kind]));
  });

  it.each(['book', 'template', 'document', 'id', 'ordinal'] as const)(
    'rejects REPLACE through the %s version conflict key',
    (key) => {
      seal();
      const second = material(sqlite, FREE_BOOK);
      const changes: Record<string, unknown> = {
        id: 'version-2',
        version_number: 2,
        predecessor_id: 'version-1',
      };
      if (key === 'book') changes.rule_book_version = BOOK;
      if (key === 'template') changes.position_template_version = BOOK;
      if (key === 'document') changes.policy_document_id = owned.documentId;
      if (key === 'id') changes.id = 'version-1';
      if (key === 'ordinal') {
        insertVersion(sqlite, second, changes);
        const third = material(sqlite, '2027.103');
        rejectUnchanged(() =>
          insertVersion(sqlite, third, { ...changes, id: 'version-other' }, 'INSERT OR REPLACE'),
        );
      } else rejectUnchanged(() => insertVersion(sqlite, second, changes, 'INSERT OR REPLACE'));
    },
  );

  it.each([
    'foreign-book-year',
    'foreign-template-year',
    'wrong-book-revision',
    'active-book',
    'designated-book',
    'designated-template',
    'foreign-rule-template',
    'foreign-rule-book',
    'duplicate-rule',
    'orphan-rule',
    'foreign-participation',
    'foreign-document',
  ] as const)('rejects %s backing at admission', (kind) => {
    material(sqlite, FREE_BOOK);
    if (kind === 'foreign-book-year')
      sqlite.exec("UPDATE rule_books SET effective_year=2028 WHERE version='2027.101'");
    if (kind === 'foreign-template-year')
      sqlite.exec("UPDATE position_templates SET effective_year=2028 WHERE version='2027.101'");
    if (kind === 'wrong-book-revision')
      sqlite.exec("UPDATE rule_books SET revision=1 WHERE version='2027.101'");
    if (kind === 'active-book')
      sqlite.exec("UPDATE rule_books SET status='active' WHERE version='2027.101'");
    if (kind === 'designated-book')
      sqlite.exec("UPDATE bid_years SET rule_book_version='2027.101' WHERE year=2027");
    if (kind === 'designated-template')
      sqlite.exec("UPDATE bid_years SET position_template_version='2027.101' WHERE year=2027");
    if (kind === 'foreign-rule-template')
      sqlite.exec(
        "UPDATE position_rules SET template_version='2027.102' WHERE rule_book_version='2027.101'",
      );
    if (kind === 'foreign-rule-book')
      sqlite.exec(
        "UPDATE position_rules SET template_version='2027.101' WHERE rule_book_version='2027.102'",
      );
    if (kind === 'duplicate-rule')
      sqlite.exec(
        "INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain) SELECT rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain FROM position_rules WHERE rule_book_version='2027.101'",
      );
    if (kind === 'orphan-rule')
      sqlite.exec(
        "UPDATE position_rules SET position_id='absent-seat' WHERE rule_book_version='2027.101'",
      );
    if (kind === 'foreign-participation')
      sqlite.exec(
        "UPDATE rule_book_position_participation SET template_version='2027.102' WHERE rule_book_version='2027.101'",
      );
    rejectUnchanged(() =>
      insertVersion(
        sqlite,
        owned,
        kind === 'foreign-document'
          ? { policy_document_id: `synthetic-document-${FREE_BOOK}` }
          : {},
      ),
    );
  });

  const sealedWrites = [
    ['book update', "UPDATE rule_books SET notes='Changed' WHERE version='2027.101'"],
    ['book lifecycle', "UPDATE rule_books SET status='active' WHERE version='2027.101'"],
    ['book delete', "DELETE FROM rule_books WHERE version='2027.101'"],
    [
      'book replace',
      "INSERT OR REPLACE INTO rule_books SELECT * FROM rule_books WHERE version='2027.101'",
    ],
    ['template update', "UPDATE position_templates SET notes='Changed' WHERE version='2027.101'"],
    ['template delete', "DELETE FROM position_templates WHERE version='2027.101'"],
    [
      'template replace',
      "INSERT OR REPLACE INTO position_templates SELECT * FROM position_templates WHERE version='2027.101'",
    ],
    [
      'position insert',
      "INSERT INTO positions SELECT 'new-seat',template_version,shift,station,division,unit,rank_required,position_name,is_floating,is_vacant_by_design,is_excluded_from_count FROM positions WHERE template_version='2027.101'",
    ],
    ['position update', "UPDATE positions SET station='8' WHERE template_version='2027.101'"],
    ['position delete', "DELETE FROM positions WHERE template_version='2027.101'"],
    [
      'position replace',
      "INSERT OR REPLACE INTO positions SELECT * FROM positions WHERE template_version='2027.101'",
    ],
    [
      'position move out',
      "UPDATE OR REPLACE positions SET template_version='2027.102' WHERE template_version='2027.101'",
    ],
    [
      'position move in',
      "UPDATE OR REPLACE positions SET template_version='2027.101' WHERE template_version='2027.102'",
    ],
    [
      'rule insert',
      "INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain) SELECT rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain FROM position_rules WHERE rule_book_version='2027.101'",
    ],
    ['rule update', "UPDATE position_rules SET notes='Changed' WHERE rule_book_version='2027.101'"],
    ['rule delete', "DELETE FROM position_rules WHERE rule_book_version='2027.101'"],
    [
      'rule numeric id replace',
      "INSERT OR REPLACE INTO position_rules SELECT id,'2027.102',position_id,'2027.102',required_criteria,points_preference,tie_break_chain,notes FROM position_rules WHERE rule_book_version='2027.101'",
    ],
    [
      'rule numeric id update replace',
      "UPDATE OR REPLACE position_rules SET id=(SELECT id FROM position_rules WHERE rule_book_version='2027.101') WHERE rule_book_version='2027.102'",
    ],
    [
      'rule move out',
      "UPDATE position_rules SET rule_book_version='2027.102',template_version='2027.102' WHERE rule_book_version='2027.101'",
    ],
    [
      'rule move in',
      "UPDATE position_rules SET rule_book_version='2027.101',template_version='2027.101' WHERE rule_book_version='2027.102'",
    ],
    [
      'participation update',
      "UPDATE rule_book_position_participation SET bid_participation='RESERVED_NON_BIDDABLE' WHERE rule_book_version='2027.101'",
    ],
    [
      'participation delete',
      "DELETE FROM rule_book_position_participation WHERE rule_book_version='2027.101'",
    ],
    [
      'participation replace',
      "INSERT OR REPLACE INTO rule_book_position_participation SELECT * FROM rule_book_position_participation WHERE rule_book_version='2027.101'",
    ],
    [
      'participation move out',
      "UPDATE rule_book_position_participation SET template_version='2027.102' WHERE rule_book_version='2027.101'",
    ],
    [
      'participation move in',
      "UPDATE rule_book_position_participation SET template_version='2027.101' WHERE rule_book_version='2027.102'",
    ],
    [
      'binding update',
      "UPDATE position_staffing_bindings SET review_status='retired' WHERE template_version='2027.101'",
    ],
    ['binding delete', "DELETE FROM position_staffing_bindings WHERE template_version='2027.101'"],
    [
      'binding replace',
      "INSERT OR REPLACE INTO position_staffing_bindings SELECT * FROM position_staffing_bindings WHERE template_version='2027.101'",
    ],
    [
      'binding move out',
      "UPDATE OR REPLACE position_staffing_bindings SET template_version='2027.102' WHERE template_version='2027.101'",
    ],
    [
      'binding move in',
      "UPDATE OR REPLACE position_staffing_bindings SET template_version='2027.101' WHERE template_version='2027.102'",
    ],
    [
      'document addition',
      "INSERT INTO annual_bid_policy_documents SELECT 'new-document',rule_book_version,effective_year,revision+1,status,policy_text,execution_policy_json,created_by,created_at,updated_at,published_by,published_at,supersedes_document_id FROM annual_bid_policy_documents WHERE rule_book_version='2027.101'",
    ],
    [
      'document update',
      "UPDATE annual_bid_policy_documents SET policy_text='Changed' WHERE rule_book_version='2027.101'",
    ],
    [
      'document publication',
      "UPDATE annual_bid_policy_documents SET status='PUBLISHED' WHERE rule_book_version='2027.101'",
    ],
    [
      'document publication metadata',
      "UPDATE annual_bid_policy_documents SET published_at=2,published_by=10001,updated_at=2 WHERE rule_book_version='2027.101'",
    ],
    [
      'document delete',
      "DELETE FROM annual_bid_policy_documents WHERE rule_book_version='2027.101'",
    ],
    [
      'document identity replace',
      "INSERT OR REPLACE INTO annual_bid_policy_documents SELECT id,'2027.102',effective_year,revision+1,status,policy_text,execution_policy_json,created_by,created_at,updated_at,published_by,published_at,supersedes_document_id FROM annual_bid_policy_documents WHERE rule_book_version='2027.101'",
    ],
  ] as const;
  it.each(sealedWrites)(
    'rejects %s after sealing with recursive delete triggers disabled',
    (_label, sql) => {
      material(sqlite, FREE_BOOK);
      seal();
      sqlite.pragma('recursive_triggers = OFF');
      rejectUnchanged(
        () => sqlite.exec(sql),
        /bid version (material|source|row identity) is immutable|annual policy document material is immutable/,
      );
    },
  );

  it.each([false, true])(
    'rejects both active-book unique collision forms with recursive_triggers=%s',
    (recursive) => {
      material(sqlite, FREE_BOOK);
      seal();
      // Explicit corruption simulation: publication is unavailable in this storage-only slice.
      // Temporarily omit only its owned-book update guard to construct an already-active owner.
      const guard = sqlite
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='bid_version_book_update'",
        )
        .get() as { sql: string };
      sqlite.exec('DROP TRIGGER bid_version_book_update');
      try {
        sqlite.exec("UPDATE rule_books SET status='active' WHERE version='2027.101'");
      } finally {
        sqlite.exec(guard.sql);
      }
      sqlite.pragma(`recursive_triggers = ${recursive ? 'ON' : 'OFF'}`);
      rejectUnchanged(() =>
        sqlite.exec(
          "INSERT OR REPLACE INTO rule_books (version,effective_year,status,revision) VALUES ('2027.999',2027,'active',0)",
        ),
      );
      rejectUnchanged(() =>
        sqlite.exec("UPDATE OR REPLACE rule_books SET status='active' WHERE version='2027.102'"),
      );
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    },
  );

  it('keeps historical profiles and source decisions append-only under replacement', () => {
    sqlite.exec(`INSERT INTO annual_plan_reviews (bid_year,effective_on,created_at) VALUES (2027,'2027-01-01',1);
      INSERT INTO annual_rule_profile_revisions VALUES (2027,1,0,'[]','[]','synthetic-reviewer','Synthetic historical profile',1);
      INSERT INTO bid_source_decisions VALUES (2027,'synthetic-issue',1,'Synthetic issue','Synthetic question','rules','OPEN','','synthetic-only','2027-01-01','synthetic-reviewer',1)`);
    sqlite.pragma('recursive_triggers = OFF');
    rejectUnchanged(() =>
      sqlite.exec(
        'INSERT OR REPLACE INTO annual_rule_profile_revisions SELECT * FROM annual_rule_profile_revisions',
      ),
    );
    rejectUnchanged(() =>
      sqlite.exec('INSERT OR REPLACE INTO bid_source_decisions SELECT * FROM bid_source_decisions'),
    );
    sqlite.exec(
      'INSERT INTO annual_rule_profile_revisions SELECT bid_year,revision+1,rule_revision,profiles_json,compiled_json,actor_subject,reason,created_at FROM annual_rule_profile_revisions',
    );
    sqlite.exec(
      'INSERT INTO bid_source_decisions SELECT bid_year,issue_id,revision+1,title,question,area,status,decision,source_ref,effective_on,actor_subject,created_at FROM bid_source_decisions',
    );
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});

describe('0059 legacy preservation', () => {
  it('preserves exact existing snapshot JSON and all legacy row values while adding empty version stores', () => {
    const sqlite = new Database(':memory:');
    try {
      migrate(sqlite, false);
      seedReferences(sqlite);
      const source = material(sqlite);
      const bytes =
        '{ "v":1, "ruleBookVersion":"2027.101", "positionTemplateVersion":"2027.101", "capturedAtMs":1, "members":[] }';
      sqlite.exec(
        "INSERT INTO bid_sessions (id,bid_year,is_mock,started_at,current_phase) VALUES ('synthetic-legacy',2027,1,1,'config')",
      );
      sqlite
        .prepare(
          'INSERT INTO bid_session_policy_snapshots (bid_session_id,rule_book_version,position_template_version,snapshot_json,captured_at) VALUES (?,?,?,?,1)',
        )
        .run('synthetic-legacy', source.alias, source.alias, bytes);
      const tables = [
        'bid_years',
        'rule_books',
        'position_templates',
        'positions',
        'position_rules',
        'rule_book_position_participation',
        'position_staffing_bindings',
        'annual_bid_policy_documents',
        'bid_sessions',
        'bid_session_policy_snapshots',
      ];
      const before = Object.fromEntries(
        tables.map((name) => [name, sqlite.prepare(`SELECT * FROM ${name}`).all()]),
      );
      sqlite.exec(readFileSync(new URL(MIGRATION, MIGRATIONS), 'utf8'));
      expect(
        Object.fromEntries(
          tables.map((name) => [name, sqlite.prepare(`SELECT * FROM ${name}`).all()]),
        ),
      ).toEqual(before);
      expect(
        sqlite
          .prepare(
            "SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id='synthetic-legacy'",
          )
          .get(),
      ).toEqual({ snapshot_json: bytes });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM bid_definition_versions').get()).toEqual(
        { count: 0 },
      );
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM bid_definition_heads').get()).toEqual({
        count: 0,
      });
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
