import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import type { BidDefinitionContent } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { app } from '../../src/index.js';
import { bidDefinitionContextHash } from '../../src/lib/bid-definition-context.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import { loadBidSessionPolicySnapshot } from '../../src/lib/bid-policy.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const YEAR = 2027;
const ACTOR = 10001;
const HASH = /^[0-9a-f]{64}$/;
type Version = Extract<Awaited<ReturnType<typeof loadBidDefinitionVersion>>, { ok: true }>;
type Preview = {
  wouldAllowCreateMock: true;
  versionId: string;
  versionSha256: string;
  versionNumber: number;
  contextSha256: string;
  runtimeSourceToken: string;
  pool: Record<string, number>;
};
type CreateBody = {
  versionId: string;
  versionSha256: string;
  expectedContextSha256: string;
  expectedSourceToken: string;
};
type Created = {
  id: string;
  current_phase: string;
  is_mock: boolean;
  rule_book_version: string;
  rule_book_revision: number;
  position_template_version: string;
  configuration_revision: number;
  settings: { expected_duration_days: number; turn_timer_seconds: number };
  pool: Record<string, number>;
  bidDefinition: {
    versionId: string;
    versionNumber: number;
    versionSha256: string;
    snapshotSha256: string;
    contextSha256: string;
  };
  replayed: boolean;
};

function noInternalMaterial(value: unknown) {
  const forbidden = new Set([
    'sourceGuard',
    'sql',
    'parameters',
    'selectedSourceSnapshotJson',
    'snapshotJson',
    'snapshot',
    'pins',
    'serialized',
    'config_json',
  ]);
  if (Array.isArray(value)) value.forEach(noInternalMaterial);
  else if (value && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) {
      expect(forbidden.has(key), `Unexpected server-only property ${key}`).toBe(false);
      noInternalMaterial(child);
    }
}

describe('managed Mock preview and atomic creation through the admin router', () => {
  let h: TestD1;
  let version: Version;
  let adminToken: string;
  let saveCounter: number;

  function seedYear(year: number) {
    const alias = `${year}.1`;
    h.sqlite
      .prepare('INSERT INTO position_templates(version,effective_year,notes) VALUES (?,?,?)')
      .run(alias, year, 'Synthetic Mock topology');
    h.sqlite
      .prepare(
        "INSERT INTO rule_books(version,effective_year,status,revision,notes) VALUES (?,?,'draft',2,?)",
      )
      .run(alias, year, 'Synthetic Mock rules');
    h.sqlite
      .prepare(`INSERT INTO bid_years(year,status,rule_book_version,position_template_version,configuration_revision,config_json)
      VALUES (?,'configuring',?,?,3,?)`)
      .run(
        year,
        alias,
        alias,
        JSON.stringify({
          v: 2,
          expectedDurationDays: 2,
          turnTimerSeconds: 180,
          credentialEvaluationOn: `${year}-01-01`,
          personnelEvaluationOn: `${year}-01-01`,
        }),
      );
    h.sqlite
      .prepare(`INSERT INTO positions(id,template_version,shift,station,division,unit,rank_required,position_name)
      VALUES (?,?,'A','7','Combat','Synthetic Engine','FF','Synthetic firefighter')`)
      .run(`synthetic-mock-seat-${year}`, alias);
    h.sqlite
      .prepare(`INSERT INTO position_rules(rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
      VALUES (?,?,?,'{"rank":["FF"],"credentials":[],"custom":[]}','{"max":0,"items":[]}','["rsc_seniority"]')`)
      .run(alias, `synthetic-mock-seat-${year}`, alias);
  }

  async function token(memberId = ACTOR, role: 'admin' | 'member' = 'admin', fresh = true) {
    return signJwt(
      {
        sub: memberId,
        emp: `synthetic-mock-${memberId}`,
        role,
        rank: 'FF',
        first_name: 'Synthetic',
        last_name: 'Reviewer',
        fresh_auth_at: Math.floor(Date.now() / 1000) - (fresh ? 0 : 86400),
      },
      h.env.JWT_SIGNING_KEY,
    );
  }

  async function adopt(year = YEAR) {
    const source = await captureBidDefinitionSource(h.env.DB, year);
    if (!source.ok) throw new Error(JSON.stringify(source));
    const saved = await saveBidDefinition(h.env.DB, {
      year,
      key: `synthetic-mock-adopt-${++saveCounter}`,
      actorSubject: String(ACTOR),
      actorId: ACTOR,
      expected: { kind: 'legacy', sourceToken: source.sourceToken },
      reason: 'Synthetic managed Mock fixture',
      intent: { operation: 'save', content: source.content },
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const loaded = await loadBidDefinitionVersion(h.env.DB, year, String(saved.response.versionId));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    return loaded;
  }

  async function successor(
    change: (content: BidDefinitionContent) => void = (content) => {
      content.notes.bid = 'Synthetic successor content';
    },
  ) {
    const content = structuredClone(version.content);
    change(content);
    const saved = await saveBidDefinition(h.env.DB, {
      year: YEAR,
      key: `synthetic-mock-next-${++saveCounter}`,
      actorSubject: String(ACTOR),
      actorId: ACTOR,
      expected: {
        kind: 'version',
        versionId: version.row.id,
        revision: version.row.version_number,
        sha256: version.sha256,
      },
      reason: 'Synthetic new Current Bid version',
      intent: { operation: 'save', content },
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const loaded = await loadBidDefinitionVersion(h.env.DB, YEAR, String(saved.response.versionId));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    return loaded;
  }

  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,employment_status,employment_status_effective_on,created_at,updated_at)
      VALUES (10001,'synthetic-mock-10001','Synthetic','First','FF','FF',1,0,'active','2020-01-01',1,1),
        (10002,'synthetic-mock-10002','Synthetic','Second','FF','FF',2,0,'active','2020-01-01',1,1);
      INSERT INTO credentials(id,name) VALUES (7001,'Synthetic dated qualification');
      INSERT INTO member_credentials(member_id,credential_id,start_date,expiration_date) VALUES (10001,7001,'2020-01-01','2027-12-31');`);
    seedYear(YEAR);
    seedYear(2028);
    saveCounter = 0;
    version = await adopt();
    adminToken = await token();
    vi.spyOn(h.env.BID_SESSION, 'get');
    vi.spyOn(h.env.BID_SESSION, 'idFromName');
    h.env.KV.put = vi.fn(async () => {});
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  function request(
    path: string,
    body: unknown,
    options: { key?: string | undefined; auth?: string | null; raw?: boolean } = {},
  ) {
    const auth = options.auth === undefined ? adminToken : options.auth;
    return app.fetch(
      new Request(`http://x/api/admin/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth === null ? {} : { Authorization: `Bearer ${auth}` }),
          ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
        },
        body: options.raw ? String(body) : JSON.stringify(body),
      }),
      h.env,
    );
  }
  function selection(selected = version) {
    return { versionId: selected.row.id, versionSha256: selected.sha256 };
  }
  function createBody(preview: Preview): CreateBody {
    return {
      versionId: preview.versionId,
      versionSha256: preview.versionSha256,
      expectedContextSha256: preview.contextSha256,
      expectedSourceToken: preview.runtimeSourceToken,
    };
  }
  async function preview(selected = version) {
    const before = h.sqlite.serialize();
    const response = await request(`bid/${selected.row.bid_year}/preview`, {
      kind: 'mock',
      ...selection(selected),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await response.json()) as Preview;
    expect(body.wouldAllowCreateMock, JSON.stringify(body)).toBe(true);
    noInternalMaterial(body);
    deepStrictEqual(h.sqlite.serialize(), before);
    return body;
  }
  async function create(body: CreateBody, key = 'synthetic-mock-create', year = YEAR) {
    const response = await request(`bid/${year}/mock-sessions`, body, { key });
    expect(response.status, await response.clone().text()).toBe(201);
    const value = (await response.json()) as Created;
    noInternalMaterial(value);
    return value;
  }
  function tableContents(excluded: readonly string[] = []) {
    const tables = h.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    return Object.fromEntries(
      tables
        .filter(({ name }) => !excluded.includes(name))
        .map(({ name }) => [
          name,
          h.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all(),
        ]),
    );
  }
  function noRuntimeWrites() {
    expect(h.env.BID_SESSION.get).not.toHaveBeenCalled();
    expect(h.env.BID_SESSION.idFromName).not.toHaveBeenCalled();
    expect(h.env.KV.put).not.toHaveBeenCalled();
    for (const table of [
      'bid_order',
      'canonical_bid_session_state',
      'bid_command_receipts',
      'bid_command_events',
      'bid_audit_outbox',
    ])
      expect(h.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  }
  async function rejection(
    path: string,
    body: unknown,
    status: number,
    error?: string,
    options: { key?: string | undefined; auth?: string | null; raw?: boolean } = {},
  ) {
    const before = h.sqlite.serialize();
    const response = await request(path, body, options);
    expect(response.status, await response.clone().text()).toBe(status);
    const value = await response.json();
    if (error) expect(value).toMatchObject({ error });
    noInternalMaterial(value);
    deepStrictEqual(h.sqlite.serialize(), before);
    noRuntimeWrites();
    return value;
  }
  function corruptSnapshot(id: string, change: string, remove = false) {
    // Corruption simulation in the isolated fixture: suspend only the relevant
    // snapshot guard, make the invalid stored row, then immediately restore it.
    const trigger = remove
      ? 'bid_session_policy_snapshots_pinned_no_delete'
      : 'bid_session_policy_snapshots_immutable';
    const guard = h.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?")
      .get(trigger) as { sql: string };
    h.sqlite.exec(`DROP TRIGGER ${trigger}`);
    try {
      h.sqlite
        .prepare(
          remove
            ? 'DELETE FROM bid_session_policy_snapshots WHERE bid_session_id=?'
            : `UPDATE bid_session_policy_snapshots SET ${change} WHERE bid_session_id=?`,
        )
        .run(id);
    } finally {
      h.sqlite.exec(guard.sql);
    }
  }

  it('previews the selected version read-only and creates exactly one pinned ordinary config session', async () => {
    const checked = await preview();
    expect(Object.keys(checked).sort()).toEqual(
      [
        'wouldAllowCreateMock',
        'versionId',
        'versionSha256',
        'versionNumber',
        'contextSha256',
        'runtimeSourceToken',
        'pool',
      ].sort(),
    );
    expect(checked).toMatchObject({
      ...selection(),
      versionNumber: 1,
      contextSha256: expect.stringMatching(HASH),
      runtimeSourceToken: expect.stringMatching(HASH),
      pool: {
        officerPoolCount: 0,
        firefighterPoolCount: 2,
        excludedCount: 0,
        administrativeAssignmentExcludedCount: 0,
      },
    });
    const allowed = [
      'bid_sessions',
      'bid_session_policy_snapshots',
      'audit_log',
      'admin_configuration_receipts',
    ];
    const before = tableContents(allowed);
    const counts = Object.fromEntries(
      allowed.map((table) => [
        table,
        (h.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
      ]),
    );
    const created = await create(createBody(checked));
    expect(Object.keys(created).sort()).toEqual(
      [
        'id',
        'current_phase',
        'is_mock',
        'rule_book_version',
        'rule_book_revision',
        'position_template_version',
        'configuration_revision',
        'settings',
        'pool',
        'bidDefinition',
        'replayed',
      ].sort(),
    );
    expect(created).toMatchObject({
      current_phase: 'config',
      is_mock: true,
      replayed: false,
      rule_book_version: version.row.rule_book_version,
      position_template_version: version.row.position_template_version,
      configuration_revision: 1,
      settings: { expected_duration_days: 2, turn_timer_seconds: 180 },
      pool: checked.pool,
      bidDefinition: {
        versionId: version.row.id,
        versionNumber: 1,
        versionSha256: version.sha256,
        contextSha256: checked.contextSha256,
        snapshotSha256: expect.stringMatching(HASH),
      },
    });
    for (const table of allowed)
      expect(h.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({
        n: (counts[table] ?? -1) + 1,
      });
    expect(tableContents(allowed)).toEqual(before);
    const row = h.sqlite
      .prepare('SELECT * FROM bid_session_policy_snapshots WHERE bid_session_id=?')
      .get(created.id) as Record<string, unknown>;
    const json = String(row.snapshot_json);
    expect(row).toMatchObject({
      rule_book_version: version.row.rule_book_version,
      rule_book_revision: version.row.rule_book_revision,
      position_template_version: version.row.position_template_version,
      bid_version_id: version.row.id,
      bid_version_sha256: version.sha256,
      context_sha256: checked.contextSha256,
      snapshot_sha256: createHash('sha256').update(json, 'utf8').digest('hex'),
    });
    expect(created.bidDefinition.snapshotSha256).toBe(row.snapshot_sha256);
    expect(JSON.parse(json)).toMatchObject({
      v: 3,
      capturedAtMs: row.captured_at,
      configurationRevision: 1,
      bidDefinition: {
        v: 1,
        bidSessionId: created.id,
        bidYear: YEAR,
        versionId: version.row.id,
        versionSha256: version.sha256,
        contextSha256: checked.contextSha256,
      },
    });
    const loaded = await loadBidSessionPolicySnapshot(getDb(h.env.DB), created.id);
    if (loaded.snapshot?.v !== 3) throw new Error(JSON.stringify(loaded));
    expect(bidDefinitionContextHash(loaded.snapshot)).toBe(checked.contextSha256);
    expect(
      loaded.snapshot.members.find((member) => member.memberId === ACTOR)?.credentialNames,
    ).toEqual(['Synthetic dated qualification']);
    const session = h.sqlite.prepare('SELECT * FROM bid_sessions WHERE id=?').get(created.id);
    expect(session).toMatchObject({
      bid_year: YEAR,
      current_phase: 'config',
      is_mock: 1,
      turn_timer_seconds: 180,
      expected_duration_days: 2,
      day_count: 0,
    });
    expect(
      h.sqlite
        .prepare('SELECT actor_type,actor_id,action FROM audit_log WHERE bid_session_id=?')
        .all(created.id),
    ).toEqual([{ actor_type: 'admin', actor_id: ACTOR, action: 'session_start' }]);
    const receipt = h.sqlite
      .prepare(
        'SELECT actor_subject,operation,response_json FROM admin_configuration_receipts WHERE idempotency_key=?',
      )
      .get('synthetic-mock-create') as {
      actor_subject: string;
      operation: string;
      response_json: string;
    };
    expect(receipt).toMatchObject({
      actor_subject: String(ACTOR),
      operation: 'bid-definition-mock-create',
    });
    const { replayed: _replayed, ...persisted } = created;
    expect(JSON.parse(receipt.response_json)).toEqual(persisted);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    noRuntimeWrites();
  });

  it('returns a real blocker with no invented tokens for a saved incomplete version', async () => {
    const incomplete = await successor((content) => {
      content.rules = [];
    });
    const before = h.sqlite.serialize();
    const response = await request('bid/2027/preview', { kind: 'mock', ...selection(incomplete) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      wouldAllowCreateMock: false,
      policyError: 'rule_book_invalid',
    });
    deepStrictEqual(h.sqlite.serialize(), before);
    await rejection(
      'bid/2027/mock-sessions',
      {
        ...selection(incomplete),
        expectedContextSha256: 'a'.repeat(64),
        expectedSourceToken: 'b'.repeat(64),
      },
      409,
      'session_policy_snapshot_unavailable',
      { key: 'blocked' },
    );
  });

  it.each(['missing', 'foreign', 'hash'])(
    'rejects %s version selection without inventing preview identity',
    async (kind) => {
      const wrong =
        kind === 'missing'
          ? { versionId: 'synthetic-unknown-version', versionSha256: version.sha256 }
          : kind === 'foreign'
            ? selection(await adopt(2028))
            : { ...selection(), versionSha256: 'f'.repeat(64) };
      const policyError = kind === 'hash' ? 'bid_version_hash_mismatch' : 'bid_version_not_found';
      const before = h.sqlite.serialize();
      const response = await request('bid/2027/preview', { kind: 'mock', ...wrong });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ wouldAllowCreateMock: false, policyError });
      deepStrictEqual(h.sqlite.serialize(), before);
      expect(
        await rejection(
          'bid/2027/mock-sessions',
          { ...wrong, expectedContextSha256: 'a'.repeat(64), expectedSourceToken: 'b'.repeat(64) },
          409,
          'session_policy_snapshot_unavailable',
          { key: 'wrong-selection' },
        ),
      ).toMatchObject({ policyError });
    },
  );

  it('creates an older version after the head moves only with a fresh source preview', async () => {
    const old = await preview();
    const newer = await successor();
    await rejection('bid/2027/mock-sessions', createBody(old), 409, 'bid_run_context_changed', {
      key: 'stale-head-preview',
    });
    const fresh = await preview(version);
    expect(fresh.contextSha256).toBe(old.contextSha256);
    expect(fresh.runtimeSourceToken).not.toBe(old.runtimeSourceToken);
    const created = await create(createBody(fresh));
    expect(created.bidDefinition).toMatchObject({ versionId: version.row.id, versionNumber: 1 });
    expect(
      h.sqlite.prepare('SELECT version_id FROM bid_definition_heads WHERE bid_year=2027').get(),
    ).toEqual({ version_id: newer.row.id });
    noRuntimeWrites();
  });

  it.each(['context', 'source'])(
    'rejects a %s change after preview before creation',
    async (kind) => {
      const checked = await preview();
      if (kind === 'context')
        h.sqlite.exec(
          "UPDATE member_credentials SET expiration_date='2026-12-31' WHERE member_id=10001 AND credential_id=7001",
        );
      else h.sqlite.exec('UPDATE annual_source_revision SET revision=revision+1 WHERE id=1');
      await rejection(
        'bid/2027/mock-sessions',
        createBody(checked),
        409,
        'bid_run_context_changed',
        { key: 'stale-source' },
      );
      const fresh = await preview();
      expect(fresh.runtimeSourceToken).not.toBe(checked.runtimeSourceToken);
      if (kind === 'context') expect(fresh.contextSha256).not.toBe(checked.contextSha256);
      else expect(fresh.contextSha256).toBe(checked.contextSha256);
    },
  );

  it('rolls back when Department evidence changes after preparation at the creation batch boundary', async () => {
    const checked = await preview();
    const original = h.env.DB.batch.bind(h.env.DB);
    let afterEvidence: ReturnType<typeof h.sqlite.serialize> | undefined;
    vi.spyOn(h.env.DB, 'batch').mockImplementationOnce(async (statements) => {
      h.sqlite.exec(
        "UPDATE member_credentials SET expiration_date='2026-12-31' WHERE member_id=10001 AND credential_id=7001",
      );
      afterEvidence = h.sqlite.serialize();
      return original(statements);
    });
    const response = await request('bid/2027/mock-sessions', createBody(checked), {
      key: 'source-race',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'bid_run_context_changed' });
    expect(afterEvidence).toBeDefined();
    deepStrictEqual(h.sqlite.serialize(), afterEvidence);
    noRuntimeWrites();
  });

  it.each([0, 1, 2, 3])(
    'rolls back the complete creation transaction on statement %i failure',
    async (index) => {
      const checked = await preview();
      h.failNextBatchAt(index);
      await rejection(
        'bid/2027/mock-sessions',
        createBody(checked),
        409,
        'bid_run_context_changed',
        { key: 'injected-rollback' },
      );
    },
  );

  it('exact-key replay remains bound to the original run after a new head and changed Department evidence', async () => {
    const body = createBody(await preview());
    const created = await create(body);
    await successor();
    h.sqlite.exec(
      "UPDATE member_credentials SET expiration_date='2026-12-31' WHERE member_id=10001 AND credential_id=7001",
    );
    const before = h.sqlite.serialize();
    expect(await create(body)).toEqual({ ...created, replayed: true });
    deepStrictEqual(h.sqlite.serialize(), before);
    await rejection(
      'bid/2027/mock-sessions',
      { ...body, expectedSourceToken: 'e'.repeat(64) },
      409,
      'idempotency_key_reused',
      { key: 'synthetic-mock-create' },
    );
    await rejection('bid/2027/mock-sessions', body, 409, 'idempotency_key_reused', {
      key: 'synthetic-mock-create',
      auth: await token(10002),
    });
    noRuntimeWrites();
  });

  it('recovers a lost committed response using the original receipt and creates no second run', async () => {
    const body = createBody(await preview());
    const original = h.env.DB.batch.bind(h.env.DB);
    vi.spyOn(h.env.DB, 'batch').mockImplementationOnce(async (statements) => {
      await original(statements);
      throw new Error('Synthetic lost response after committed Mock creation');
    });
    const created = await create(body);
    expect(created.replayed).toBe(true);
    const before = h.sqlite.serialize();
    expect(await create(body)).toEqual(created);
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_sessions').get()).toEqual({ n: 1 });
  });

  it.each(['bid_version_sha256', 'snapshot_sha256', 'context_sha256', 'metadata', 'missing'])(
    'rejects receipt replay with damaged %s before any additional writes',
    async (kind) => {
      const body = createBody(await preview());
      const created = await create(body);
      corruptSnapshot(
        created.id,
        kind === 'metadata'
          ? "snapshot_json=json_remove(snapshot_json,'$.bidDefinition')"
          : `${kind}='${'f'.repeat(64)}'`,
        kind === 'missing',
      );
      await rejection(
        'bid/2027/mock-sessions',
        body,
        409,
        'session_policy_snapshot_integrity_invalid',
        { key: 'synthetic-mock-create' },
      );
    },
  );

  it.each(['preview', 'mock-sessions'])(
    'requires admin and fresh step-up for %s',
    async (operation) => {
      const checked = await preview();
      const body = operation === 'preview' ? { kind: 'mock', ...selection() } : createBody(checked);
      const path = `bid/2027/${operation}`;
      await rejection(path, body, 401, 'missing_auth', { key: 'auth', auth: null });
      await rejection(path, body, 403, 'forbidden', {
        key: 'auth',
        auth: await token(ACTOR, 'member'),
      });
      await rejection(path, body, 401, 'step_up_required', {
        key: 'auth',
        auth: await token(ACTOR, 'admin', false),
      });
    },
  );

  it.each([undefined, '', '\u00a0padded', 'padded\u00a0', 'x'.repeat(201)])(
    'rejects missing, untrimmed or overlong mutation key %#',
    async (key) => {
      await rejection(
        'bid/2027/mock-sessions',
        createBody(await preview()),
        400,
        key === undefined ? 'idempotency_key_required' : 'invalid_idempotency_key',
        { key },
      );
    },
  );

  it('accepts an exact 200-character key without normalization', async () => {
    const body = createBody(await preview());
    const key = 'k'.repeat(200);
    const first = await create(body, key);
    const before = h.sqlite.serialize();
    expect(await create(body, key)).toEqual({ ...first, replayed: true });
    deepStrictEqual(h.sqlite.serialize(), before);
  });

  it('rejects missing/invalid fields, client identity overrides and unsupported mode fields', async () => {
    const valid = createBody(await preview());
    const invalid: unknown[] = [
      null,
      [],
      {},
      { ...valid, versionId: ` ${valid.versionId}` },
      { ...valid, versionSha256: valid.versionSha256.toUpperCase() },
      { ...valid, expectedContextSha256: '' },
      { ...valid, expectedSourceToken: null },
      { ...valid, mode: 'live' },
      { ...valid, mode: 'mock' },
      { ...valid, is_mock: true },
      { ...valid, is_mock: false },
      { ...valid, actorId: 10002 },
      { ...valid, bid_year: 2028 },
      { ...valid, turn_timer_seconds: 60 },
    ];
    for (const field of Object.keys(valid)) {
      const missing = { ...valid } as Record<string, unknown>;
      delete missing[field];
      invalid.push(missing);
    }
    for (const body of invalid)
      await rejection('bid/2027/mock-sessions', body, 400, undefined, { key: 'invalid-body' });
    for (const body of [
      { kind: 'mock', ...selection(), mode: 'live' },
      { kind: 'live', ...selection(), expectedSourceToken: valid.expectedSourceToken },
      { kind: 'mock', ...selection(), expectedSourceToken: valid.expectedSourceToken },
    ])
      await rejection('bid/2027/preview', body, 400);
    await rejection('bid/2027/mock-sessions', '{invalid-json', 400, undefined, {
      key: 'bad-json',
      raw: true,
    });
  });

  it.each(['2027x', '2023', '2101', '2099'])(
    'rejects an invalid or absent year %s',
    async (year) => {
      const body = createBody(await preview());
      await rejection(
        `bid/${year}/mock-sessions`,
        body,
        year === '2099' ? 404 : 400,
        year === '2099' ? 'bid_year_not_found' : 'invalid_bid_year',
        { key: 'wrong-year' },
      );
    },
  );

  it('preserves a legacy unpinned snapshot and exact legacy receipt after its year becomes managed', async () => {
    const sourceRevision = (
      h.sqlite.prepare('SELECT revision FROM annual_source_revision WHERE id=1').get() as {
        revision: number;
      }
    ).revision;
    const body = {
      bid_year: 2028,
      mode: 'mock',
      expected_rule_revision: 2,
      expected_configuration_revision: 3,
      expected_source_revision: sourceRevision,
    };
    const first = await request('bid-session', body, { key: 'legacy-before-adoption' });
    expect(first.status, await first.clone().text()).toBe(201);
    const legacy = (await first.json()) as { id: string };
    const original = h.sqlite
      .prepare('SELECT * FROM bid_session_policy_snapshots WHERE bid_session_id=?')
      .get(legacy.id);
    expect(original).toMatchObject({
      bid_version_id: null,
      bid_version_sha256: null,
      context_sha256: null,
      snapshot_sha256: null,
    });
    await adopt(2028);
    const before = h.sqlite.serialize();
    const replay = await request('bid-session', body, { key: 'legacy-before-adoption' });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual({ ...legacy, replayed: true });
    deepStrictEqual(h.sqlite.serialize(), before);
    await rejection(
      'bid-session',
      { bid_year: 2028, mode: 'mock' },
      409,
      'managed_bid_version_required',
    );
    expect(
      h.sqlite
        .prepare('SELECT * FROM bid_session_policy_snapshots WHERE bid_session_id=?')
        .get(legacy.id),
    ).toEqual(original);
    const loaded = await loadBidSessionPolicySnapshot(getDb(h.env.DB), legacy.id);
    expect(loaded.snapshot?.v).toBe(3);
    noRuntimeWrites();
  });

  it('rejects legacy creation when adoption wins at its batch boundary, preserving the adoption', async () => {
    const original = h.env.DB.batch.bind(h.env.DB);
    let afterAdoption: ReturnType<typeof h.sqlite.serialize> | undefined;
    vi.spyOn(h.env.DB, 'batch').mockImplementationOnce(async (statements) => {
      await adopt(2028);
      afterAdoption = h.sqlite.serialize();
      return original(statements);
    });
    const response = await request('bid-session', { bid_year: 2028, mode: 'mock' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'managed_bid_version_required' });
    expect(afterAdoption).toBeDefined();
    deepStrictEqual(h.sqlite.serialize(), afterAdoption);
    noRuntimeWrites();
  });
});
