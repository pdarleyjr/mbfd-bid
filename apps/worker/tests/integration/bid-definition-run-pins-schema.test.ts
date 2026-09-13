import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { BidSessionPolicySnapshotSchema } from '@mbfd/shared';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalBidDefinition } from '../../src/lib/bid-definition-content.js';
import { validateBidDefinitionSnapshotPin } from '../../src/lib/bid-definition-pin.js';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);
const MIGRATION = '0060_bid_definition_run_pins.sql';
const NOW = 1_800_000_000_000;
const CONTEXT = '2'.repeat(64);
const SEAT = 'synthetic-pin-seat';
const RULE = {
  positionId: SEAT,
  requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
  pointsPreferenceJson: '{"max":0,"items":[]}',
  tieBreakChainJson: '["rsc_seniority"]',
  notes: null,
};
const POSITION = {
  id: SEAT,
  shift: 'A',
  station: '7',
  division: 'Combat',
  unit: 'Synthetic Engine – é',
  rankRequired: 'FF',
  positionName: 'Synthetic firefighter',
  isFloating: false,
  isVacantByDesign: false,
  isExcludedFromCount: false,
};
const PIN_COLUMNS = ['bid_version_id', 'bid_version_sha256', 'snapshot_sha256', 'context_sha256'];
const LEGACY_COLUMNS = [
  'bid_session_id',
  'rule_book_version',
  'position_template_version',
  'snapshot_json',
  'captured_at',
  'rule_book_revision',
];
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function migrate(sqlite: Database.Database, includePins = true) {
  for (const name of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    if (name > MIGRATION || (!includePins && name === MIGRATION)) continue;
    sqlite.exec(readFileSync(new URL(name, MIGRATIONS), 'utf8'));
  }
  sqlite.pragma('foreign_keys = ON');
}

function insert(
  sqlite: Database.Database,
  table: string,
  row: Record<string, unknown>,
  verb = 'INSERT',
) {
  return sqlite
    .prepare(
      `${verb} INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row)
        .map(() => '?')
        .join(',')})`,
    )
    .run(...Object.values(row));
}

function references(sqlite: Database.Database) {
  sqlite.exec(`INSERT OR IGNORE INTO bid_years (year,status) VALUES (2027,'configuring'),(2028,'configuring');
    INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at)
    VALUES (10001,'synthetic-pin-actor','Synthetic','Reviewer','CHIEF','EXCLUDED',1,0,1,1)`);
}

function backing(sqlite: Database.Database, alias = '2027.101', year = 2027) {
  sqlite
    .prepare(
      "INSERT INTO rule_books (version,effective_year,status,revision) VALUES (?,?,'draft',0)",
    )
    .run(alias, year);
  sqlite
    .prepare('INSERT INTO position_templates (version,effective_year) VALUES (?,?)')
    .run(alias, year);
  return { alias, year };
}

// A structurally valid, incomplete draft deliberately has no readiness or
// publication authority. Real source rows and canonical bytes supply its pins.
function version(
  sqlite: Database.Database,
  id = 'version-1',
  alias = '2027.101',
  year = 2027,
  predecessor: string | null = null,
  ordinal = 1,
) {
  const source = backing(sqlite, alias, year);
  sqlite
    .prepare(`INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
    VALUES (?,?,'A','7','Combat',?,'FF','Synthetic firefighter')`)
    .run(SEAT, alias, POSITION.unit);
  sqlite
    .prepare(`INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
    VALUES (?,?,?,?,?,?)`)
    .run(
      alias,
      SEAT,
      alias,
      RULE.requiredCriteriaJson,
      RULE.pointsPreferenceJson,
      RULE.tieBreakChainJson,
    );
  const content = canonicalBidDefinition({
    v: 1,
    bidYear: year,
    settings: {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: `${year}-01-01`,
    },
    notes: { bid: null, positions: null },
    policy: null,
    planning: null,
    authoring: null,
    positions: [POSITION],
    rules: [RULE],
    participation: [],
    staffingBindings: [],
    sourceDecisions: [],
  });
  if (!content.ok) throw new Error(JSON.stringify(content.issues));
  insert(sqlite, 'bid_definition_versions', {
    id,
    bid_year: year,
    version_number: ordinal,
    schema_version: 1,
    content_json: content.serialized,
    content_sha256: content.sha256,
    origin_json: '{}',
    rule_book_version: alias,
    rule_book_revision: 0,
    position_template_version: alias,
    policy_document_id: null,
    predecessor_id: predecessor,
    restored_from_id: null,
    actor_subject: '10001',
    reason: 'Synthetic pin storage fixture',
    created_at: NOW,
  });
  return { ...source, id, sha256: content.sha256 };
}
type Version = ReturnType<typeof version>;

function session(
  sqlite: Database.Database,
  id = 'synthetic-session',
  overrides: Record<string, unknown> = {},
  verb = 'INSERT',
) {
  return insert(
    sqlite,
    'bid_sessions',
    {
      id,
      bid_year: 2027,
      started_at: NOW,
      current_phase: 'config',
      turn_timer_seconds: 180,
      expected_duration_days: 2,
      is_mock: 1,
      ...overrides,
    },
    verb,
  );
}

function body(source: Version, sessionId = 'synthetic-session') {
  const snapshot = BidSessionPolicySnapshotSchema.parse({
    v: 3,
    ruleBookVersion: source.alias,
    ruleBookRevision: 0,
    positionTemplateVersion: source.alias,
    configurationRevision: 4,
    settings: {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: `${source.year}-01-01`,
    },
    credentialEvaluationOn: `${source.year}-01-01`,
    capturedAtMs: NOW,
    members: [],
    ruleBookMaterial: {
      v: 1,
      rules: [
        {
          ruleBookVersion: source.alias,
          templateVersion: source.alias,
          positionId: SEAT,
          requiredCriteriaJson: RULE.requiredCriteriaJson,
          pointsPreferenceJson: RULE.pointsPreferenceJson,
          tieBreakChainJson: RULE.tieBreakChainJson,
        },
      ],
      positions: [
        {
          id: SEAT,
          templateVersion: source.alias,
          bidParticipation: 'BIDDABLE',
          isExcludedFromCount: false,
          shift: 'A',
          station: '7',
          unit: POSITION.unit,
          rankRequired: 'FF',
          positionName: 'Synthetic firefighter',
        },
      ],
    },
  });
  return {
    ...snapshot,
    bidDefinition: {
      v: 1,
      bidSessionId: sessionId,
      bidYear: source.year,
      versionId: source.id,
      versionSha256: source.sha256,
      contextSha256: CONTEXT,
    },
  };
}

function pinned(
  source: Version,
  value: unknown = body(source),
  sessionId = 'synthetic-session',
): Record<string, unknown> {
  const serialized = JSON.stringify(value);
  return {
    bid_session_id: sessionId,
    rule_book_version: source.alias,
    position_template_version: source.alias,
    rule_book_revision: 0,
    snapshot_json: serialized,
    captured_at: NOW,
    bid_version_id: source.id,
    bid_version_sha256: source.sha256,
    snapshot_sha256: hash(serialized),
    context_sha256: CONTEXT,
  };
}

function legacy(alias = '2027.90', sessionId = 'synthetic-session'): Record<string, unknown> {
  const snapshot = BidSessionPolicySnapshotSchema.parse({
    v: 1,
    ruleBookVersion: alias,
    positionTemplateVersion: alias,
    capturedAtMs: NOW,
    members: [],
  });
  return {
    bid_session_id: sessionId,
    rule_book_version: alias,
    position_template_version: alias,
    rule_book_revision: null,
    snapshot_json: JSON.stringify(snapshot, null, 2),
    captured_at: NOW,
  };
}

function editPath(value: unknown, path: string, next: unknown) {
  const segments = path.split('.');
  let parent = value as Record<string, unknown>;
  for (const key of segments.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  const key = segments.at(-1) as string;
  if (next === undefined) delete parent[key];
  else parent[key] = next;
}

describe('Bid run pin storage migration', () => {
  let sqlite: Database.Database;
  let owned: Version;
  beforeEach(() => {
    sqlite = new Database(':memory:');
    migrate(sqlite);
    references(sqlite);
    owned = version(sqlite);
    backing(sqlite, '2027.90');
    session(sqlite);
    session(sqlite, 'other-session');
    session(sqlite, 'foreign-session', { bid_year: 2028 });
  });
  afterEach(() => sqlite.close());
  const write = (row: Record<string, unknown>, verb = 'INSERT') =>
    insert(sqlite, 'bid_session_policy_snapshots', row, verb);
  function rejectUnchanged(action: () => unknown) {
    const before = sqlite.serialize();
    expect(action).toThrow();
    deepStrictEqual(sqlite.serialize(), before);
  }
  function manage() {
    sqlite.exec(
      "INSERT INTO bid_definition_heads (bid_year,version_id,revision) VALUES (2027,'version-1',1)",
    );
  }

  it('preserves pre-migration snapshot bytes, every legacy field and NULL provenance after the year becomes managed', () => {
    const old = new Database(':memory:');
    try {
      migrate(old, false);
      references(old);
      backing(old, '2027.90');
      session(old);
      insert(old, 'bid_session_policy_snapshots', legacy());
      const before = old
        .prepare(`SELECT ${LEGACY_COLUMNS.join(',')} FROM bid_session_policy_snapshots`)
        .get();
      const sessionsBefore = old.prepare('SELECT * FROM bid_sessions').all();
      old.exec(readFileSync(new URL(MIGRATION, MIGRATIONS), 'utf8'));
      version(old);
      old.exec(
        "INSERT INTO bid_definition_heads (bid_year,version_id,revision) VALUES (2027,'version-1',1)",
      );
      expect(
        old.prepare(`SELECT ${LEGACY_COLUMNS.join(',')} FROM bid_session_policy_snapshots`).get(),
      ).toEqual(before);
      expect(old.prepare('SELECT * FROM bid_sessions').all()).toEqual(sessionsBefore);
      expect(
        old.prepare(`SELECT ${PIN_COLUMNS.join(',')} FROM bid_session_policy_snapshots`).get(),
      ).toEqual(Object.fromEntries(PIN_COLUMNS.map((key) => [key, null])));
      expect(old.pragma('foreign_key_check')).toEqual([]);
    } finally {
      old.close();
    }
  });

  it('admits complete V3 pins with foreign keys enabled, without a head or publication authority', () => {
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    write(pinned(owned));
    expect(sqlite.prepare('SELECT bid_version_id FROM bid_session_policy_snapshots').get()).toEqual(
      { bid_version_id: owned.id },
    );
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_definition_heads').get()).toEqual({
      count: 0,
    });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    const fk = sqlite.pragma('foreign_key_list(bid_session_policy_snapshots)') as {
      table: string;
      from: string;
      on_delete: string;
    }[];
    expect(fk).toContainEqual(
      expect.objectContaining({
        table: 'bid_definition_versions',
        from: 'bid_version_id',
        on_delete: 'RESTRICT',
      }),
    );
  });

  it('allows pinning an older immutable version after the head advances', () => {
    manage();
    const next = version(sqlite, 'version-2', '2027.102', 2027, owned.id, 2);
    sqlite
      .prepare('UPDATE bid_definition_heads SET version_id=?,revision=2 WHERE bid_year=2027')
      .run(next.id);
    write(pinned(owned));
    expect(sqlite.prepare('SELECT bid_version_id FROM bid_session_policy_snapshots').get()).toEqual(
      { bid_version_id: owned.id },
    );
  });

  it('keeps unmanaged all-NULL legacy inserts and legacy parent edits/deletion available', () => {
    write(legacy());
    expect(
      sqlite.prepare(`SELECT ${PIN_COLUMNS.join(',')} FROM bid_session_policy_snapshots`).get(),
    ).toEqual(Object.fromEntries(PIN_COLUMNS.map((key) => [key, null])));
    sqlite.exec(
      "UPDATE bid_sessions SET config_json='{}',turn_timer_seconds=90,is_mock=0 WHERE id='synthetic-session'",
    );
    sqlite.exec("DELETE FROM bid_sessions WHERE id='synthetic-session'");
    expect(
      sqlite.prepare('SELECT count(*) AS count FROM bid_session_policy_snapshots').get(),
    ).toEqual({ count: 0 });
  });

  it('requires pins for managed years even when the referenced material is unowned legacy material', () => {
    manage();
    rejectUnchanged(() => write(legacy()));
  });

  it.each(['book', 'template', 'both'])(
    'requires pins for version-owned %s without a head',
    (ownership) => {
      const row = legacy();
      if (ownership !== 'template') row.rule_book_version = owned.alias;
      if (ownership !== 'book') row.position_template_version = owned.alias;
      rejectUnchanged(() => write(row));
    },
  );

  it.each(Array.from({ length: 14 }, (_, index) => index + 1))(
    'rejects mixed-NULL pin mask %i',
    (mask) => {
      const row = pinned(owned);
      PIN_COLUMNS.forEach((column, bit) => {
        if ((mask & (1 << bit)) !== 0) row[column] = null;
      });
      rejectUnchanged(() => write(row));
    },
  );

  it.each([null, {}, { v: 1 }, false, 'legacy'])(
    'rejects body pin metadata %j on all-NULL legacy rows',
    (pin) => {
      const row = legacy();
      row.snapshot_json = JSON.stringify({
        ...JSON.parse(row.snapshot_json as string),
        bidDefinition: pin,
      });
      rejectUnchanged(() => write(row));
    },
  );

  const identityPaths = [
    'v',
    'ruleBookVersion',
    'positionTemplateVersion',
    'ruleBookRevision',
    'capturedAtMs',
    'bidDefinition',
    'bidDefinition.v',
    'bidDefinition.bidSessionId',
    'bidDefinition.bidYear',
    'bidDefinition.versionId',
    'bidDefinition.versionSha256',
    'bidDefinition.contextSha256',
    'settings',
    'settings.expectedDurationDays',
    'settings.turnTimerSeconds',
  ];
  it.each(identityPaths.flatMap((path) => [undefined, null].map((value) => ({ path, value }))))(
    'rejects missing/null identity $path=$value',
    ({ path, value }) => {
      const valueBody = body(owned);
      editPath(valueBody, path, value);
      rejectUnchanged(() => write(pinned(owned, valueBody)));
    },
  );

  it.each([
    ['v', 2],
    ['v', '3'],
    ['v', 3.5],
    ['ruleBookVersion', '2027.90'],
    ['positionTemplateVersion', '2027.90'],
    ['ruleBookRevision', 1],
    ['ruleBookRevision', '0'],
    ['capturedAtMs', NOW + 1],
    ['capturedAtMs', String(NOW)],
    ['bidDefinition.v', 2],
    ['bidDefinition.v', '1'],
    ['bidDefinition.bidSessionId', 'other-session'],
    ['bidDefinition.bidYear', 2028],
    ['bidDefinition.bidYear', '2027'],
    ['bidDefinition.versionId', 'missing-version'],
    ['bidDefinition.versionSha256', '3'.repeat(64)],
    ['bidDefinition.contextSha256', '3'.repeat(64)],
    ['settings.expectedDurationDays', 3],
    ['settings.turnTimerSeconds', 90],
    ['settings.turnTimerSeconds', '180'],
  ])('rejects tampered body identity %s=%j', (path, value) => {
    const valueBody = body(owned);
    editPath(valueBody, path as string, value);
    rejectUnchanged(() => write(pinned(owned, valueBody)));
  });

  it.each([
    ['bid_session_id', 'missing-session'],
    ['bid_session_id', 'foreign-session'],
    ['bid_version_id', 'missing-version'],
    ['bid_version_sha256', '3'.repeat(64)],
    ['rule_book_version', '2027.90'],
    ['position_template_version', '2027.90'],
    ['rule_book_revision', 1],
    ['rule_book_revision', null],
    ['rule_book_revision', -1],
    ['captured_at', NOW + 1],
    ['captured_at', -1],
    ['captured_at', 1.5],
  ])('rejects tampered row identity %s=%j', (column, value) => {
    rejectUnchanged(() => write({ ...pinned(owned), [column as string]: value }));
  });

  it('rejects an internally consistent foreign-year pin against the actual session parent', () => {
    const foreign = version(sqlite, 'foreign-version', '2028.101', 2028);
    rejectUnchanged(() => write(pinned(foreign)));
  });

  it.each(
    ['bid_version_sha256', 'snapshot_sha256', 'context_sha256'].flatMap((column) =>
      [
        '',
        'a'.repeat(63),
        'a'.repeat(65),
        'G'.repeat(64),
        'A'.repeat(64),
        `${'a'.repeat(64)}\0tail`,
      ].map((value) => ({ column, value })),
    ),
  )('rejects malformed digest $column=$value', ({ column, value }) => {
    const row = pinned(owned);
    row[column] = value;
    rejectUnchanged(() => write(row));
  });

  it.each(['bidDefinition', 'settings', 'root'])(
    'rejects duplicate keys in %s rather than allowing SQLite/JS identity disagreement',
    (location) => {
      const row = pinned(owned);
      const json = row.snapshot_json as string;
      const prefix = location === 'root' ? '{' : `"${location}":{`;
      const at = json.indexOf(prefix);
      expect(at).toBeGreaterThanOrEqual(0);
      const offset = at + prefix.length;
      const duplicate =
        location === 'root'
          ? '"v":3,'
          : location === 'bidDefinition'
            ? '"v":1,'
            : '"turnTimerSeconds":180,';
      row.snapshot_json = json.slice(0, offset) + duplicate + json.slice(offset);
      row.snapshot_sha256 = hash(row.snapshot_json as string);
      rejectUnchanged(() => write(row));
    },
  );

  it('rejects extra metadata keys, including a self-referential snapshot digest', () => {
    const valueBody = {
      ...body(owned),
      bidDefinition: { ...body(owned).bidDefinition, snapshotSha256: '4'.repeat(64) },
    };
    rejectUnchanged(() => write(pinned(owned, valueBody)));
  });

  it.each([0, 1])('admits valid run mode %i and rejects invalid stored modes', (mode) => {
    sqlite.prepare('UPDATE bid_sessions SET is_mock=? WHERE id=?').run(mode, 'synthetic-session');
    write(pinned(owned));
    sqlite.prepare('UPDATE bid_sessions SET is_mock=2 WHERE id=?').run('other-session');
    rejectUnchanged(() => write(pinned(owned, body(owned, 'other-session'), 'other-session')));
  });

  it.each([
    ['turn_timer_seconds', 'turnTimerSeconds', 0],
    ['turn_timer_seconds', 'turnTimerSeconds', 601],
    ['expected_duration_days', 'expectedDurationDays', 0],
    ['expected_duration_days', 'expectedDurationDays', 8],
  ])('rejects consistently invalid parent/body timer %s=%s=%i', (column, setting, value) => {
    sqlite.prepare(`UPDATE bid_sessions SET ${column}=? WHERE id='synthetic-session'`).run(value);
    const valueBody = body(owned);
    editPath(valueBody, `settings.${setting}`, value);
    rejectUnchanged(() => write(pinned(owned, valueBody)));
  });

  it.each([
    '',
    ' synthetic-session ',
    '\tsynthetic-session',
    '\u00a0synthetic-session',
    'synthetic-session\uFEFF',
  ])('rejects consistently invalid row/body/parent session identity %j', (id) => {
    session(sqlite, id);
    const valueBody = body(owned, id);
    rejectUnchanged(() => write(pinned(owned, valueBody, id)));
  });

  it('rejects a well-formed row/body version hash that disagrees with immutable content', () => {
    const valueBody = body(owned);
    valueBody.bidDefinition.versionSha256 = '3'.repeat(64);
    rejectUnchanged(() =>
      write({ ...pinned(owned, valueBody), bid_version_sha256: '3'.repeat(64) }),
    );
  });

  it('keeps exact digest verification in the shared runtime validator', () => {
    const row: Record<string, unknown> = { ...pinned(owned), snapshot_sha256: '4'.repeat(64) };
    write(row);
    const checked = validateBidDefinitionSnapshotPin({
      row: {
        bidSessionId: 'synthetic-session',
        bidYear: 2027,
        ruleBookVersion: owned.alias,
        positionTemplateVersion: owned.alias,
        ruleBookRevision: 0,
        capturedAtMs: NOW,
        snapshotJson: row.snapshot_json as string,
        bidVersionId: owned.id,
        bidVersionSha256: owned.sha256,
        snapshotSha256: row.snapshot_sha256 as string,
        contextSha256: CONTEXT,
      },
      expectedBidSessionId: 'synthetic-session',
      version: {
        id: owned.id,
        bidYear: 2027,
        contentSha256: owned.sha256,
        ruleBookVersion: owned.alias,
        positionTemplateVersion: owned.alias,
        ruleBookRevision: 0,
      },
    });
    expect(checked).toMatchObject({ ok: false, reason: 'snapshot_digest_mismatch' });
  });

  it.each([false, true])(
    'protects snapshot ID/rowid replacements and pinned deletes with recursive triggers=%s',
    (recursive) => {
      sqlite.pragma(`recursive_triggers = ${recursive ? 'ON' : 'OFF'}`);
      write(pinned(owned));
      const original = sqlite
        .prepare('SELECT rowid FROM bid_session_policy_snapshots WHERE bid_session_id=?')
        .get('synthetic-session') as { rowid: number };
      rejectUnchanged(() => write(pinned(owned), 'INSERT OR REPLACE'));
      rejectUnchanged(() =>
        write(
          {
            ...pinned(owned, body(owned, 'other-session'), 'other-session'),
            rowid: original.rowid,
          },
          'INSERT OR REPLACE',
        ),
      );
      rejectUnchanged(() =>
        sqlite.exec(
          "DELETE FROM bid_session_policy_snapshots WHERE bid_session_id='synthetic-session'",
        ),
      );
      rejectUnchanged(() =>
        sqlite.exec(
          "UPDATE bid_session_policy_snapshots SET context_sha256=context_sha256 WHERE bid_session_id='synthetic-session'",
        ),
      );
    },
  );

  it.each([false, true])(
    'protects legacy snapshot bytes from ID and rowid replacement with recursive triggers=%s',
    (recursive) => {
      sqlite.pragma(`recursive_triggers = ${recursive ? 'ON' : 'OFF'}`);
      write(legacy());
      const original = sqlite
        .prepare('SELECT rowid FROM bid_session_policy_snapshots WHERE bid_session_id=?')
        .get('synthetic-session') as { rowid: number };
      rejectUnchanged(() => write(legacy(), 'INSERT OR REPLACE'));
      rejectUnchanged(() =>
        write(
          { ...legacy('2027.90', 'other-session'), rowid: original.rowid },
          'INSERT OR REPLACE',
        ),
      );
      sqlite.exec(
        "DELETE FROM bid_session_policy_snapshots WHERE bid_session_id='synthetic-session'",
      );
    },
  );

  it.each([false, true])(
    'protects pinned parent ID/rowid INSERT and UPDATE replacements with recursive triggers=%s',
    (recursive) => {
      sqlite.pragma(`recursive_triggers = ${recursive ? 'ON' : 'OFF'}`);
      write(pinned(owned));
      const original = sqlite
        .prepare('SELECT rowid FROM bid_sessions WHERE id=?')
        .get('synthetic-session') as { rowid: number };
      rejectUnchanged(() => session(sqlite, 'synthetic-session', {}, 'INSERT OR REPLACE'));
      rejectUnchanged(() =>
        session(sqlite, 'new-session', { rowid: original.rowid }, 'INSERT OR REPLACE'),
      );
      rejectUnchanged(() =>
        sqlite.exec(
          "UPDATE OR REPLACE bid_sessions SET id='synthetic-session' WHERE id='other-session'",
        ),
      );
      rejectUnchanged(() =>
        sqlite
          .prepare("UPDATE OR REPLACE bid_sessions SET rowid=? WHERE id='other-session'")
          .run(original.rowid),
      );
      rejectUnchanged(() => sqlite.exec("DELETE FROM bid_sessions WHERE id='synthetic-session'"));
    },
  );

  it.each([
    ['id', 'changed-session'],
    ['rowid', 999],
    ['bid_year', 2028],
    ['is_mock', 0],
    ['config_json', '{}'],
    ['turn_timer_seconds', 90],
    ['expected_duration_days', 3],
  ])('seals pinned parent %s while leaving legacy mutations available', (column, value) => {
    write(pinned(owned));
    rejectUnchanged(() =>
      sqlite.prepare(`UPDATE bid_sessions SET ${column}=? WHERE id='synthetic-session'`).run(value),
    );
    sqlite.prepare(`UPDATE bid_sessions SET ${column}=? WHERE id='other-session'`).run(value);
  });

  it('preserves operational lifecycle and no-op identity updates for pinned sessions', () => {
    write(pinned(owned));
    sqlite.exec(`UPDATE bid_sessions SET started_at=started_at+1,current_phase='paused',paused_at=${NOW},
      completed_at=${NOW},current_bidder_id=10001,current_turn_started_at=${NOW},scheduled_resume_at=${NOW},
      day_count=1,frozen_at=${NOW},freeze_actor_id=10001,freeze_reason='Synthetic pause',mock_control_revision=1,
      id=id,bid_year=bid_year,is_mock=is_mock,config_json=config_json,
      turn_timer_seconds=turn_timer_seconds,expected_duration_days=expected_duration_days
      WHERE id='synthetic-session'`);
    expect(
      sqlite
        .prepare('SELECT current_phase,day_count,started_at FROM bid_sessions WHERE id=?')
        .get('synthetic-session'),
    ).toEqual({ current_phase: 'paused', day_count: 1, started_at: NOW + 1 });
  });

  it('characterizes every declared session unique index so a future collision key requires a new guard', () => {
    const indexes = sqlite.pragma('index_list(bid_sessions)') as { name: string; unique: number }[];
    expect(
      indexes
        .filter((index) => index.unique)
        .map((index) =>
          (sqlite.pragma(`index_info('${index.name}')`) as { name: string }[]).map(
            (column) => column.name,
          ),
        ),
    ).toEqual([['id']]);
  });
});
