import { deepStrictEqual } from 'node:assert';
import type { BidDefinitionContent } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import type { SaveBidDefinitionInput } from '../../src/lib/bid-definition-store.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const YEAR = 2027;
const ACTOR = 10001;
const SEAT = 'synthetic-facade-biddable';
const RESERVED = 'synthetic-facade-reserved';
const REASON = 'Synthetic Bid editing receipt';
const NOT_EVALUATED = {
  status: 'NOT_EVALUATED',
  code: 'saved_version_required_for_mock_preview',
};
type Expected = SaveBidDefinitionInput['expected'];
type Metadata = {
  id: string;
  versionNumber: number;
  contentSha256: string;
  createdAtMs: number;
  actorSubject: string;
  reason: string;
  predecessorId: string | null;
  restoredFromId: string | null;
};
type Current = {
  bidYear: number;
  state: 'LEGACY_UNADOPTED' | 'VERSIONED';
  version: Metadata | null;
  content: BidDefinitionContent;
  expected: Expected;
  coverage: Record<string, unknown>;
  stats: Record<string, unknown>;
};
type Receipt = {
  changed: boolean;
  replayed: boolean;
  versionId: string;
  versionNumber: number;
  contentSha256: string;
  predecessorId: string | null;
  restoredFromId: string | null;
};

const FORBIDDEN_KEYS = new Set([
  'sourceGuard',
  'sql',
  'parameters',
  'selectedSourceSnapshotJson',
  'snapshotJson',
  'serialized',
  'origin_json',
  'content_json',
  'config_json',
  'settingsJson',
  'snapshot',
  'pins',
]);
function expectNoInternalMaterial(value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) expectNoInternalMaterial(item);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      expect(FORBIDDEN_KEYS.has(key), `Unexpected internal DTO key: ${key}`).toBe(false);
      expectNoInternalMaterial(item);
    }
  }
  if (typeof value === 'string') expect(value).not.toBe('bid-definition-content-v1');
}

describe('Current Bid definition facade', () => {
  let h: TestD1;
  let adminToken: string;
  let legacy: { content: BidDefinitionContent; expected: Expected };

  async function token(memberId = ACTOR, role: 'admin' | 'member' = 'admin', fresh = true) {
    return signJwt(
      {
        sub: memberId,
        emp: `synthetic-facade-${memberId}`,
        role,
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Editor',
        fresh_auth_at: Math.floor(Date.now() / 1000) - (fresh ? 0 : 86_400),
      },
      h.env.JWT_SIGNING_KEY,
    );
  }

  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
        VALUES (10001,'synthetic-facade-10001','Synthetic','First','FF','FF',1,1,1),
          (10002,'synthetic-facade-10002','Synthetic','Second','FF','FF',2,1,1);
      INSERT INTO position_templates(version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic topology notes');
      INSERT INTO rule_books(version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',2,'Synthetic rule notes');
      INSERT INTO bid_years(year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',3,
          '{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-01","personnelEvaluationOn":"2027-01-01"}');
      INSERT INTO bid_years(year,status) VALUES (2028,'configuring');
      INSERT INTO positions(id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('${SEAT}','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic firefighter'),
          ('${RESERVED}','2027.1','D','7','Administration','Synthetic Office','FF','Synthetic reserved position');
      INSERT INTO position_rules(rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','${SEAT}','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}',
          '{"max":0,"items":[]}','["rsc_seniority"]');
      INSERT INTO rule_book_position_participation(rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
        VALUES ('2027.1','${RESERVED}','2027.1','RESERVED_NON_BIDDABLE','Synthetic reserved source',1);
    `);
    const captured = await captureBidDefinitionSource(h.env.DB, YEAR);
    if (!captured.ok) throw new Error(JSON.stringify(captured));
    legacy = {
      content: captured.content,
      expected: { kind: 'legacy', sourceToken: captured.sourceToken },
    };
    adminToken = await token();
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  function request(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      rawBody?: string;
      key?: string | undefined;
      auth?: string | null;
    } = {},
  ) {
    const auth = options.auth === undefined ? adminToken : options.auth;
    return app.fetch(
      new Request(`http://x/api/admin/bid/${path}`, {
        method:
          options.method ??
          (options.body === undefined && options.rawBody === undefined ? 'GET' : 'POST'),
        headers: {
          ...(auth === null ? {} : { Authorization: `Bearer ${auth}` }),
          'Content-Type': 'application/json',
          ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
        },
        ...(options.rawBody === undefined
          ? options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }
          : { body: options.rawBody }),
      }),
      h.env,
    );
  }

  async function current(): Promise<Current> {
    const response = await request('2027/current');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const value = (await response.json()) as Current;
    expectNoInternalMaterial(value);
    return value;
  }

  async function save(
    content = legacy.content,
    expected = legacy.expected,
    key = 'synthetic-facade-save-1',
  ) {
    const response = await request('2027/versions', {
      body: { expected, content, reason: REASON },
      key,
    });
    expect(response.status).toBe(201);
    const receipt = (await response.json()) as Receipt;
    expectNoInternalMaterial(receipt);
    return receipt;
  }

  function preview(
    expected: Expected,
    intent: { operation: 'save'; content: unknown } | { operation: 'restore'; versionId: string },
  ) {
    return request('2027/preview', { body: { kind: 'definition', expected, intent } });
  }

  function expectNoRuns() {
    for (const table of [
      'bid_sessions',
      'bid_session_policy_snapshots',
      'bid_order',
      'canonical_bid_session_state',
      'bid_command_receipts',
      'bid_command_events',
      'bid_audit_outbox',
    ]) {
      expect(h.sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({
        count: 0,
      });
    }
  }

  function backingMaterial() {
    return {
      heads: h.sqlite.prepare('SELECT * FROM bid_definition_heads').all(),
      versions: h.sqlite.prepare('SELECT * FROM bid_definition_versions').all(),
      templates: h.sqlite.prepare('SELECT * FROM position_templates').all(),
      books: h.sqlite.prepare('SELECT * FROM rule_books').all(),
      positions: h.sqlite.prepare('SELECT * FROM positions').all(),
      rules: h.sqlite.prepare('SELECT * FROM position_rules').all(),
    };
  }

  it('reads actual legacy content with no invented version or exposed server control', async () => {
    const bytes = h.sqlite.serialize();
    const value = await current();
    expect(Object.keys(value).sort()).toEqual(
      ['bidYear', 'state', 'version', 'content', 'expected', 'coverage', 'stats'].sort(),
    );
    expect(value).toMatchObject({
      bidYear: YEAR,
      state: 'LEGACY_UNADOPTED',
      version: null,
      expected: legacy.expected,
    });
    expect(value.content).toEqual(legacy.content);
    expect(value.coverage).toEqual({
      valid: true,
      ruleCount: 1,
      missingBiddablePositionIds: [],
      invalidPositionIds: [],
      duplicatePositionIds: [],
      nonBiddablePositionIds: [],
      unexpectedPositionIds: [],
    });
    expect(value.stats).toEqual({
      opportunityCount: 2,
      ruleCount: 1,
      biddableCount: 1,
      administrativelyAssignedCount: 0,
      reservedCount: 1,
      excludedCount: 0,
      missingRuleCount: 0,
    });
    expect(value).not.toHaveProperty('mockReadiness');
    expect(value).not.toHaveProperty('liveReadiness');
    deepStrictEqual(h.sqlite.serialize(), bytes);
    expectNoRuns();
  });

  it('previews adoption without writing or claiming population readiness', async () => {
    const bytes = h.sqlite.serialize();
    const response = await preview(legacy.expected, { operation: 'save', content: legacy.content });
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value).toMatchObject({
      valid: true,
      content: legacy.content,
      wouldCreateVersion: true,
      mockReadiness: NOT_EVALUATED,
    });
    expect(value).toHaveProperty('contentSha256', expect.stringMatching(/^[0-9a-f]{64}$/));
    expectNoInternalMaterial(value);
    deepStrictEqual(h.sqlite.serialize(), bytes);
    expectNoRuns();
  });

  it('saves through the real store and returns whitelisted immutable current/detail metadata', async () => {
    const receipt = await save();
    expect(receipt).toMatchObject({
      changed: true,
      replayed: false,
      versionNumber: 1,
      predecessorId: null,
      restoredFromId: null,
    });
    const value = await current();
    expect(value.state).toBe('VERSIONED');
    expect(value.expected).toEqual({
      kind: 'version',
      versionId: receipt.versionId,
      revision: 1,
      sha256: receipt.contentSha256,
    });
    expect(value.content).toEqual(legacy.content);
    expect(value.version).toEqual({
      id: receipt.versionId,
      versionNumber: 1,
      contentSha256: receipt.contentSha256,
      actorSubject: String(ACTOR),
      reason: REASON,
      createdAtMs: expect.any(Number),
      predecessorId: null,
      restoredFromId: null,
    });
    expect(value.version?.createdAtMs).toBeGreaterThan(1_000_000_000_000);
    const bytes = h.sqlite.serialize();
    const detailResponse = await request(`2027/versions/${receipt.versionId}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.headers.get('Cache-Control')).toBe('private, no-store');
    const detail = await detailResponse.json();
    expect(detail).toEqual({
      bidYear: YEAR,
      version: value.version,
      content: value.content,
      coverage: value.coverage,
      stats: value.stats,
    });
    expectNoInternalMaterial(detail);
    deepStrictEqual(h.sqlite.serialize(), bytes);
    expectNoRuns();
  });

  it('reports exact added, removed and changed semantic records without writing', async () => {
    const biddable = legacy.content.positions.find((position) => position.id === SEAT);
    const reserved = legacy.content.positions.find((position) => position.id === RESERVED);
    const participation = legacy.content.participation.find((row) => row.positionId === RESERVED);
    if (!biddable || !reserved || !participation)
      throw new Error('Synthetic topology fixture missing');
    const addedId = 'synthetic-facade-added-reserved';
    const candidate: BidDefinitionContent = {
      ...legacy.content,
      positions: [
        { ...biddable, positionName: 'Synthetic amended label' },
        { ...reserved, id: addedId },
      ],
      rules: legacy.content.rules.map((rule) => ({
        ...rule,
        notes: 'Synthetic amended rule note',
      })),
      participation: [{ ...participation, positionId: addedId }],
      notes: { ...legacy.content.notes, bid: 'Synthetic amended Bid note' },
    };
    const bytes = h.sqlite.serialize();
    const response = await preview(legacy.expected, { operation: 'save', content: candidate });
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value).toMatchObject({
      valid: true,
      wouldCreateVersion: true,
      mockReadiness: NOT_EVALUATED,
      diff: {
        positions: { addedIds: [addedId], removedIds: [RESERVED], changedIds: [SEAT] },
        rules: { addedIds: [], removedIds: [], changedIds: [SEAT] },
        participation: { addedIds: [addedId], removedIds: [RESERVED], changedIds: [] },
        staffingBindings: { addedIds: [], removedIds: [], changedIds: [] },
        sourceDecisions: { addedIds: [], removedIds: [], changedIds: [] },
        changedSections: ['notes'],
      },
    });
    expectNoInternalMaterial(value);
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it('suppresses a semantic no-op while preserving a separate receipt and original creation time', async () => {
    const first = await save();
    const value = await current();
    const candidate = structuredClone(value.content);
    candidate.positions.reverse();
    candidate.rules = candidate.rules.map((rule) => ({
      ...rule,
      requiredCriteriaJson: '{ "custom": [], "credentials": [], "rank": ["FF"] }',
    }));
    const bytes = h.sqlite.serialize();
    const previewResponse = await preview(value.expected, {
      operation: 'save',
      content: candidate,
    });
    expect(previewResponse.status).toBe(200);
    expect(await previewResponse.json()).toMatchObject({
      valid: true,
      wouldCreateVersion: false,
      contentSha256: first.contentSha256,
      mockReadiness: NOT_EVALUATED,
    });
    deepStrictEqual(h.sqlite.serialize(), bytes);
    const before = backingMaterial();
    const response = await request('2027/versions', {
      body: { expected: value.expected, content: candidate, reason: REASON },
      key: 'synthetic-no-op',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      changed: false,
      replayed: false,
      versionId: first.versionId,
      versionNumber: 1,
      contentSha256: first.contentSha256,
    });
    expect(backingMaterial()).toEqual(before);
    expect((await current()).version?.createdAtMs).toBe(value.version?.createdAtMs);
    expect(
      h.sqlite.prepare('SELECT count(*) AS count FROM admin_configuration_receipts').get(),
    ).toEqual({ count: 2 });
    expect(h.sqlite.prepare('SELECT count(*) AS count FROM audit_log').get()).toEqual({ count: 2 });
    expectNoRuns();
  });

  it('restores as a new version, including equal-content restore, and paginates immutable history', async () => {
    const first = await save();
    const initial = await current();
    const changed = {
      ...initial.content,
      notes: { ...initial.content.notes, bid: 'Synthetic later editing intention' },
    };
    const second = await save(changed, initial.expected, 'synthetic-save-2');
    expect(second).toMatchObject({ versionNumber: 2, predecessorId: first.versionId });
    const next = await current();
    const bytes = h.sqlite.serialize();
    const restorePreview = await preview(next.expected, {
      operation: 'restore',
      versionId: first.versionId,
    });
    expect(restorePreview.status).toBe(200);
    expect(await restorePreview.json()).toMatchObject({
      valid: true,
      wouldCreateVersion: true,
      contentSha256: first.contentSha256,
      mockReadiness: NOT_EVALUATED,
    });
    deepStrictEqual(h.sqlite.serialize(), bytes);
    const response = await request('2027/restore', {
      body: { expected: next.expected, versionId: first.versionId, reason: REASON },
      key: 'synthetic-restore',
    });
    expect(response.status).toBe(201);
    const third = (await response.json()) as Receipt;
    expect(third).toMatchObject({
      changed: true,
      versionNumber: 3,
      contentSha256: first.contentSha256,
      predecessorId: second.versionId,
      restoredFromId: first.versionId,
    });
    expect(third.versionId).not.toBe(first.versionId);
    const restored = await current();
    const samePreview = await preview(restored.expected, {
      operation: 'restore',
      versionId: first.versionId,
    });
    expect(await samePreview.json()).toMatchObject({
      valid: true,
      wouldCreateVersion: true,
      contentSha256: first.contentSha256,
    });
    const equalRestore = await request('2027/restore', {
      body: { expected: restored.expected, versionId: first.versionId, reason: REASON },
      key: 'synthetic-equal-restore',
    });
    expect(equalRestore.status).toBe(201);
    const fourth = (await equalRestore.json()) as Receipt;
    expect(fourth).toMatchObject({
      changed: true,
      versionNumber: 4,
      contentSha256: first.contentSha256,
      predecessorId: third.versionId,
      restoredFromId: first.versionId,
    });
    const historyBytes = h.sqlite.serialize();
    const restoreReplay = await request('2027/restore', {
      body: { expected: next.expected, versionId: first.versionId, reason: REASON },
      key: 'synthetic-restore',
    });
    expect(restoreReplay.status).toBe(201);
    expect(await restoreReplay.json()).toEqual({ ...third, replayed: true });
    deepStrictEqual(h.sqlite.serialize(), historyBytes);
    const firstPage = await request('2027/versions?limit=2');
    expect(firstPage.status).toBe(200);
    expect(firstPage.headers.get('Cache-Control')).toBe('private, no-store');
    const page = (await firstPage.json()) as {
      bidYear: number;
      versions: Metadata[];
      nextBeforeVersionNumber: number | null;
    };
    expect(Object.keys(page).sort()).toEqual(
      ['bidYear', 'versions', 'nextBeforeVersionNumber'].sort(),
    );
    expect(page.versions.map((version) => [version.id, version.versionNumber])).toEqual([
      [fourth.versionId, 4],
      [third.versionId, 3],
    ]);
    expect(page.nextBeforeVersionNumber).toBe(3);
    const secondPage = await request(
      `2027/versions?limit=2&beforeVersionNumber=${page.nextBeforeVersionNumber}`,
    );
    expect(secondPage.status).toBe(200);
    const tail = (await secondPage.json()) as typeof page;
    expect(tail.versions.map((version) => [version.id, version.versionNumber])).toEqual([
      [second.versionId, 2],
      [first.versionId, 1],
    ]);
    expect(tail.nextBeforeVersionNumber).toBeNull();
    for (const metadata of [...page.versions, ...tail.versions]) {
      expect(Object.keys(metadata).sort()).toEqual(
        [
          'id',
          'versionNumber',
          'contentSha256',
          'createdAtMs',
          'actorSubject',
          'reason',
          'predecessorId',
          'restoredFromId',
        ].sort(),
      );
    }
    expectNoInternalMaterial(page);
    expectNoInternalMaterial(tail);
    deepStrictEqual(h.sqlite.serialize(), historyBytes);
    expectNoRuns();
  });

  it('replays the original changed and no-op receipts after a later head without substituting current content', async () => {
    const first = await save();
    const initial = await current();
    const noOpBody = { expected: initial.expected, content: initial.content, reason: REASON };
    const noOp = await request('2027/versions', { body: noOpBody, key: 'synthetic-no-op' });
    expect(noOp.status).toBe(200);
    const noOpReceipt = await noOp.json();
    await save(
      {
        ...initial.content,
        notes: { ...initial.content.notes, bid: 'Synthetic new current content' },
      },
      initial.expected,
      'synthetic-save-2',
    );
    const bytes = h.sqlite.serialize();
    const replay = await request('2027/versions', {
      body: { ...legacy, reason: REASON },
      key: 'synthetic-facade-save-1',
    });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual({ ...first, replayed: true });
    const noOpReplay = await request('2027/versions', { body: noOpBody, key: 'synthetic-no-op' });
    expect(noOpReplay.status).toBe(200);
    expect(await noOpReplay.json()).toEqual({ ...(noOpReceipt as object), replayed: true });
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it('recovers a committed response loss using the same receipt and creates no second version', async () => {
    const original = h.env.DB.batch.bind(h.env.DB);
    vi.spyOn(h.env.DB, 'batch').mockImplementationOnce(async (statements) => {
      await original(statements);
      throw new Error('Synthetic transport response lost after committed batch');
    });
    const first = await save();
    expect(first).toMatchObject({ changed: true, replayed: true, versionNumber: 1 });
    const bytes = h.sqlite.serialize();
    expect(await save()).toEqual(first);
    deepStrictEqual(h.sqlite.serialize(), bytes);
    expect(h.sqlite.prepare('SELECT count(*) AS count FROM bid_definition_versions').get()).toEqual(
      { count: 1 },
    );
  });

  it('rejects stale expectations in save and preview without writing', async () => {
    await save();
    const bytes = h.sqlite.serialize();
    const staleSave = await request('2027/versions', {
      body: { ...legacy, reason: REASON },
      key: 'synthetic-stale-save',
    });
    expect(staleSave.status).toBe(409);
    expect(await staleSave.json()).toMatchObject({ error: 'bid_definition_or_source_changed' });
    const stalePreview = await preview(legacy.expected, {
      operation: 'save',
      content: legacy.content,
    });
    expect(stalePreview.status).toBe(409);
    expect(await stalePreview.json()).toMatchObject({ error: 'bid_definition_or_source_changed' });
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it('binds receipt identity to actor, intent and reason', async () => {
    const first = await save();
    const bytes = h.sqlite.serialize();
    for (const options of [
      { body: { ...legacy, reason: 'Synthetic different reason' }, auth: adminToken },
      { body: { ...legacy, reason: REASON }, auth: await token(10002) },
    ]) {
      const response = await request('2027/versions', {
        ...options,
        key: 'synthetic-facade-save-1',
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: 'idempotency_key_reused' });
    }
    const value = await current();
    const wrongOperation = await request('2027/restore', {
      body: { expected: value.expected, versionId: first.versionId, reason: REASON },
      key: 'synthetic-facade-save-1',
    });
    expect(wrongOperation.status).toBe(409);
    expect(await wrongOperation.json()).toMatchObject({ error: 'idempotency_key_reused' });
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it('reports invalid candidate issues in a read-only preview and rejects the same save', async () => {
    const bytes = h.sqlite.serialize();
    const response = await preview(legacy.expected, { operation: 'save', content: { v: 1 } });
    expect(response.status).toBe(200);
    const value = (await response.json()) as {
      valid: boolean;
      issues: unknown[];
      mockReadiness: unknown;
    };
    expect(value).toMatchObject({ valid: false, mockReadiness: NOT_EVALUATED });
    expect(value.issues.length).toBeGreaterThan(0);
    expect(value).not.toHaveProperty('contentSha256');
    expectNoInternalMaterial(value);
    const invalidSave = await request('2027/versions', {
      body: { expected: legacy.expected, content: { v: 1 }, reason: REASON },
      key: 'synthetic-invalid-save',
    });
    expect(invalidSave.status).toBe(400);
    expect(await invalidSave.json()).toMatchObject({
      error: 'invalid_bid_definition',
      issues: expect.any(Array),
    });
    deepStrictEqual(h.sqlite.serialize(), bytes);
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
    'rejects a resolved source decision with $label $field through Save',
    async ({ field, value }) => {
      const candidate = structuredClone(legacy.content);
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
      const bytes = h.sqlite.serialize();
      const response = await request('2027/versions', {
        body: { expected: legacy.expected, content: candidate, reason: REASON },
        key: `synthetic-incomplete-source-${field}`,
      });
      const result = await response.json();
      expect(response.status, JSON.stringify(result)).toBe(400);
      expect(result).toMatchObject({
        error: 'invalid_bid_definition',
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ['sourceDecisions', 0, field] }),
        ]),
      });
      const reviewed = await preview(legacy.expected, { operation: 'save', content: candidate });
      expect(reviewed.status).toBe(200);
      expect(await reviewed.json()).toMatchObject({
        valid: false,
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ['sourceDecisions', 0, field] }),
        ]),
      });
      deepStrictEqual(h.sqlite.serialize(), bytes);
      expectNoRuns();
    },
  );

  it('retains an incomplete OPEN source decision as editable saved content', async () => {
    const candidate = structuredClone(legacy.content);
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
    await save(candidate);
    expect((await current()).content.sourceDecisions).toEqual(candidate.sourceDecisions);
    expectNoRuns();
  });

  it.each([
    ['title', 200],
    ['question', 3000],
    ['decision', 4000],
    ['sourceRef', 1000],
  ] as const)(
    'rejects a resolved source decision above the %s maximum without writes',
    async (field, maximum) => {
      const candidate = structuredClone(legacy.content);
      candidate.sourceDecisions = [
        {
          issueId: 'synthetic-source-maximum',
          title: 'Synthetic policy question',
          question: 'Which synthetic source controls?',
          area: 'annual-policy',
          status: 'RESOLVED',
          decision: 'Use the reviewed synthetic source interpretation.',
          sourceRef: 'Synthetic source document, section 4',
          effectiveOn: '2027-01-01',
          [field]: `  ${'x'.repeat(maximum + 1)}  `,
        },
      ];
      const bytes = h.sqlite.serialize();
      const response = await request('2027/versions', {
        body: { expected: legacy.expected, content: candidate, reason: REASON },
        key: `synthetic-source-maximum-${field}`,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: 'invalid_bid_definition',
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ['sourceDecisions', 0, field] }),
        ]),
      });
      deepStrictEqual(h.sqlite.serialize(), bytes);
    },
  );

  it.each(['minimum', 'maximum'] as const)(
    'preserves whitespace at valid trimmed source decision %s bounds through Save and history',
    async (boundary) => {
      const candidate = structuredClone(legacy.content);
      const bounded = (maximum: number) =>
        ` \t${'x'.repeat(boundary === 'minimum' ? 4 : maximum)}\n `;
      candidate.sourceDecisions = [
        {
          issueId: 'synthetic-source-valid-boundary',
          title: bounded(200),
          question: bounded(3000),
          area: 'annual-policy',
          status: 'RESOLVED',
          decision: bounded(4000),
          sourceRef: bounded(1000),
          effectiveOn: '2027-01-01',
        },
      ];
      const saved = await save(candidate);
      expect((await current()).content.sourceDecisions).toEqual(candidate.sourceDecisions);
      const history = await request(`2027/versions/${saved.versionId}`);
      expect(history.status).toBe(200);
      expect(await history.json()).toMatchObject({
        content: { sourceDecisions: candidate.sourceDecisions },
        version: { contentSha256: saved.contentSha256 },
      });
      expectNoRuns();
    },
  );

  it('allows an incomplete draft while preserving missing coverage and unevaluated runtime readiness', async () => {
    const incomplete = { ...legacy.content, rules: [] };
    const bytes = h.sqlite.serialize();
    const response = await preview(legacy.expected, { operation: 'save', content: incomplete });
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value).toMatchObject({
      valid: true,
      mockReadiness: NOT_EVALUATED,
      wouldCreateVersion: true,
      coverage: { valid: false, ruleCount: 0, missingBiddablePositionIds: [SEAT] },
      stats: {
        opportunityCount: 2,
        ruleCount: 0,
        biddableCount: 1,
        reservedCount: 1,
        missingRuleCount: 1,
      },
    });
    expectNoInternalMaterial(value);
    deepStrictEqual(h.sqlite.serialize(), bytes);
    const saved = await save(incomplete);
    expect(saved.versionNumber).toBe(1);
    expect((await current()).content.rules).toEqual([]);
    expectNoRuns();
  });

  it('reports an actual missing staffing reference before attempting a save', async () => {
    const candidate: BidDefinitionContent = {
      ...legacy.content,
      staffingBindings: [
        {
          positionId: SEAT,
          staffingPositionId: 'synthetic-missing-staffing-position',
          authoritativeSourceRef: 'Synthetic binding intention',
          reviewStatus: 'approved',
        },
      ],
    };
    const bytes = h.sqlite.serialize();
    const issue = {
      path: ['staffingBindings', 0, 'staffingPositionId'],
      code: 'staffing_position_not_found',
    };
    const response = await preview(legacy.expected, { operation: 'save', content: candidate });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining(issue)]),
      mockReadiness: NOT_EVALUATED,
    });
    const saveResponse = await request('2027/versions', {
      body: { expected: legacy.expected, content: candidate, reason: REASON },
      key: 'synthetic-missing-staffing-save',
    });
    expect(saveResponse.status).toBe(400);
    expect(await saveResponse.json()).toMatchObject({
      error: 'invalid_bid_definition',
      issues: expect.arrayContaining([expect.objectContaining(issue)]),
    });
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it('rejects contradictory rules on a reserved position with actionable issues', async () => {
    const rule = legacy.content.rules[0];
    if (!rule) throw new Error('Synthetic rule fixture missing');
    const invalid = {
      ...legacy.content,
      rules: [...legacy.content.rules, { ...rule, positionId: RESERVED }],
    };
    const bytes = h.sqlite.serialize();
    const response = await preview(legacy.expected, { operation: 'save', content: invalid });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'rule_on_non_biddable_position' }),
      ]),
      mockReadiness: NOT_EVALUATED,
    });
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it.each(['current', 'versions', 'versions/nonexistent'] as const)(
    'protects %s reads with admin auth while allowing stale-step-up reads',
    async (path) => {
      const bytes = h.sqlite.serialize();
      expect((await request(`2027/${path}`, { auth: null })).status).toBe(401);
      expect((await request(`2027/${path}`, { auth: await token(ACTOR, 'member') })).status).toBe(
        403,
      );
      const stale = await request(`2027/${path}`, { auth: await token(ACTOR, 'admin', false) });
      expect(stale.status).toBe(path === 'versions/nonexistent' ? 404 : 200);
      deepStrictEqual(h.sqlite.serialize(), bytes);
    },
  );

  it.each(['versions', 'restore', 'preview'] as const)(
    'requires authenticated admin step-up for POST %s',
    async (path) => {
      const bytes = h.sqlite.serialize();
      const body =
        path === 'versions'
          ? { ...legacy, reason: REASON }
          : path === 'restore'
            ? { expected: legacy.expected, versionId: 'synthetic-missing', reason: REASON }
            : {
                kind: 'definition',
                expected: legacy.expected,
                intent: { operation: 'save', content: legacy.content },
              };
      expect(
        (await request(`2027/${path}`, { body, key: 'synthetic-auth', auth: null })).status,
      ).toBe(401);
      expect(
        (
          await request(`2027/${path}`, {
            body,
            key: 'synthetic-auth',
            auth: await token(ACTOR, 'member'),
          })
        ).status,
      ).toBe(403);
      const stale = await request(`2027/${path}`, {
        body,
        key: 'synthetic-auth',
        auth: await token(ACTOR, 'admin', false),
      });
      expect(stale.status).toBe(401);
      expect(await stale.json()).toMatchObject({ error: 'step_up_required' });
      deepStrictEqual(h.sqlite.serialize(), bytes);
    },
  );

  it.each(['2023', '2101', '2027.5', 'not-a-year'])(
    'rejects invalid year path %s',
    async (year) => {
      const bytes = h.sqlite.serialize();
      const response = await request(`${year}/current`);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_bid_year' });
      deepStrictEqual(h.sqlite.serialize(), bytes);
    },
  );

  it.each([
    'limit=0',
    'limit=101',
    'limit=1.5',
    'limit=wrong',
    'beforeVersionNumber=0',
    'beforeVersionNumber=1.5',
  ])('rejects malformed history pagination %s', async (query) => {
    const bytes = h.sqlite.serialize();
    expect((await request(`2027/versions?${query}`)).status).toBe(400);
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it.each([undefined, '', 'k'.repeat(201), '\u00a0key', 'key\u00a0'])(
    'rejects missing or non-exact mutation key %j',
    async (key) => {
      // Headers normalizes ASCII OWS; NBSP remains observable at the Worker and
      // proves that the route rejects a key its store would otherwise trim.
      const bytes = h.sqlite.serialize();
      const response = await request('2027/versions', { body: { ...legacy, reason: REASON }, key });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: expect.stringMatching(/^(idempotency_key_required|invalid_idempotency_key)$/),
      });
      deepStrictEqual(h.sqlite.serialize(), bytes);
    },
  );

  it.each(['outer', 'expected', 'intent', 'actor', 'client-hash'] as const)(
    'rejects unknown %s transport fields instead of accepting client authority',
    async (kind) => {
      const expected =
        kind === 'expected' ? { ...legacy.expected, unexpected: true } : legacy.expected;
      const body =
        kind === 'intent'
          ? {
              kind: 'definition',
              expected,
              intent: { operation: 'save', content: legacy.content, unexpected: true },
            }
          : {
              expected,
              content: legacy.content,
              reason: REASON,
              ...(kind === 'outer' ? { unexpected: true } : {}),
              ...(kind === 'actor' ? { actorSubject: 'forged-actor', actorId: 10002 } : {}),
              ...(kind === 'client-hash' ? { contentSha256: '0'.repeat(64) } : {}),
            };
      const bytes = h.sqlite.serialize();
      const response = await request(`2027/${kind === 'intent' ? 'preview' : 'versions'}`, {
        body,
        key: 'synthetic-strict',
      });
      expect(response.status).toBe(400);
      deepStrictEqual(h.sqlite.serialize(), bytes);
    },
  );

  it('rejects malformed JSON and a candidate from another year without writes', async () => {
    const bytes = h.sqlite.serialize();
    expect(
      (await request('2027/versions', { rawBody: '{not-json', key: 'synthetic-invalid-json' }))
        .status,
    ).toBe(400);
    const wrongYear = await request('2027/versions', {
      body: {
        expected: legacy.expected,
        content: { ...legacy.content, bidYear: 2028 },
        reason: REASON,
      },
      key: 'synthetic-wrong-year',
    });
    expect(wrongYear.status).toBe(400);
    expect(await wrongYear.json()).toMatchObject({ error: 'bid_definition_year_mismatch' });
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it('rejects unknown restore and preview envelope fields without writing', async () => {
    const first = await save();
    const value = await current();
    const bytes = h.sqlite.serialize();
    const restore = await request('2027/restore', {
      body: {
        expected: value.expected,
        versionId: first.versionId,
        reason: REASON,
        actorId: 10002,
      },
      key: 'synthetic-forged-restore',
    });
    expect(restore.status).toBe(400);
    const malformedPreview = await request('2027/preview', {
      body: {
        kind: 'definition',
        expected: value.expected,
        intent: { operation: 'save', content: value.content },
        allowLive: true,
      },
    });
    expect(malformedPreview.status).toBe(400);
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it('rejects padded version identities without silently renaming the target', async () => {
    const first = await save();
    const value = await current();
    const bytes = h.sqlite.serialize();
    const detail = await request(`2027/versions/${encodeURIComponent(` ${first.versionId}`)}`);
    expect(detail.status).toBe(400);
    expect(await detail.json()).toMatchObject({ error: 'invalid_version_id' });
    const restore = await request('2027/restore', {
      body: { expected: value.expected, versionId: `${first.versionId} `, reason: REASON },
      key: 'synthetic-padded-restore',
    });
    expect(restore.status).toBe(400);
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it('returns actual not-found errors for unknown years and foreign-year version IDs', async () => {
    const saved = await save();
    const bytes = h.sqlite.serialize();
    const unknownYear = await request('2029/current');
    expect(unknownYear.status).toBe(404);
    expect(await unknownYear.json()).toMatchObject({ error: 'bid_year_not_found' });
    for (const path of ['2027/versions/nonexistent', `2028/versions/${saved.versionId}`]) {
      const response = await request(path);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: 'bid_version_not_found' });
    }
    const value = await current();
    const missingRestore = await request('2027/restore', {
      body: { expected: value.expected, versionId: 'synthetic-nonexistent', reason: REASON },
      key: 'synthetic-restore-missing',
    });
    expect(missingRestore.status).toBe(404);
    expect(await missingRestore.json()).toMatchObject({ error: 'bid_version_not_found' });
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it('fails closed on corrupt immutable content without returning a partial current or detail', async () => {
    const saved = await save();
    // Isolated corruption simulation: bypass only the version UPDATE seal;
    // retain every FK, material, lineage, ownership and head guard.
    h.sqlite.exec('DROP TRIGGER bid_definition_versions_no_update');
    h.sqlite
      .prepare(`UPDATE bid_definition_versions
      SET content_json=json_set(content_json,'$.notes.bid','Synthetic corrupt material') WHERE id=?`)
      .run(saved.versionId);
    const bytes = h.sqlite.serialize();
    for (const path of ['2027/current', `2027/versions/${saved.versionId}`]) {
      const response = await request(path);
      expect(response.status).toBe(409);
      const value = await response.json();
      expect(value).toMatchObject({ error: 'bid_version_integrity_failed' });
      expect(value).not.toHaveProperty('content');
      expectNoInternalMaterial(value);
    }
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });
});
