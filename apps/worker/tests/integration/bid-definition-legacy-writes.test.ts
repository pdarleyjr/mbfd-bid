import { deepStrictEqual } from 'node:assert';
import { BidDispositionSchema, FrozenLiveBidPolicySchema, LiveBidActionSchema } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index.js';
import { auditInsertStatement } from '../../src/lib/audit.js';
import {
  type LegacyBidWriteTarget,
  findManagedLegacyBidWrite,
  legacyBidWriteCondition,
} from '../../src/lib/bid-definition-legacy-write.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const YEAR = 2027;
const BOOK = '2027.1';
const SEAT = 'synthetic-seat-2027';
const DOCUMENT = 'synthetic-document-2027';
const ACTOR = 10001;
const REASON = 'Synthetic reviewed legacy configuration edit';
const REASON_CODE = 'rule_override.policy_direction';
type StoredVersion = Extract<Awaited<ReturnType<typeof loadBidDefinitionVersion>>, { ok: true }>;

function policyFor(seat: string) {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-legacy-write-policy',
    stages: [
      {
        id: 'synthetic-ff',
        label: 'Synthetic firefighter stage',
        order: 0,
        memberIds: [ACTOR],
        opportunityPositionIds: [seat],
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
      actorMemberIds: [ACTOR],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
  });
}

// All identities, policy language and Department rows here are explicitly
// synthetic. Real source capture and the real store create each immutable head.
describe('managed Bid boundary for legacy authoring', () => {
  let h: TestD1;
  let token: string;
  let ruleId: number;
  let adoptionKey: number;

  function seedYear(year: number, alias = `${year}.1`) {
    const seat = `synthetic-seat-${year}`;
    const document = `synthetic-document-${year}`;
    h.sqlite
      .prepare("INSERT OR IGNORE INTO bid_years(year,status) VALUES (?,'configuring')")
      .run(year);
    const execution = policyFor(seat);
    const settings = {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: `${year}-01-01`,
      personnelEvaluationOn: `${year}-01-01`,
      livePolicy: execution,
    };
    h.sqlite
      .prepare('INSERT INTO position_templates(version,effective_year,notes) VALUES (?,?,?)')
      .run(alias, year, 'Synthetic legacy topology');
    h.sqlite
      .prepare(
        "INSERT INTO rule_books(version,effective_year,status,revision,notes) VALUES (?,?,'draft',2,?)",
      )
      .run(alias, year, 'Synthetic legacy rules');
    h.sqlite
      .prepare(`INSERT INTO positions
      (id,template_version,shift,station,division,unit,rank_required,position_name)
      VALUES (?,?,'A','7','Combat','Synthetic Engine','FF','Synthetic firefighter')`)
      .run(seat, alias);
    const rule = h.sqlite
      .prepare(`INSERT INTO position_rules
      (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
      VALUES (?,?,?,'{"rank":["FF"],"credentials":[],"custom":[]}','{"max":0,"items":[]}','["rsc_seniority"]')`)
      .run(alias, seat, alias);
    h.sqlite
      .prepare(`INSERT INTO annual_bid_policy_documents
      (id,rule_book_version,effective_year,revision,status,policy_text,execution_policy_json,created_by,created_at,updated_at)
      VALUES (?,?,?,1,'DRAFT',?,?,?,1,1)`)
      .run(
        document,
        alias,
        year,
        'Synthetic policy document for legacy-write tests only.',
        JSON.stringify(execution),
        ACTOR,
      );
    h.sqlite
      .prepare(`INSERT INTO bid_years
      (year,status,rule_book_version,position_template_version,annual_policy_document_id,configuration_revision,config_json)
      VALUES (?,'configuring',?,?,?,3,?)
      ON CONFLICT(year) DO UPDATE SET rule_book_version=excluded.rule_book_version,
      position_template_version=excluded.position_template_version,annual_policy_document_id=excluded.annual_policy_document_id,
      configuration_revision=excluded.configuration_revision,config_json=excluded.config_json`)
      .run(year, alias, alias, document, JSON.stringify(settings));
    h.sqlite
      .prepare(`INSERT INTO annual_plan_reviews(bid_year,effective_on,source_policy_text,created_at)
      VALUES (?,?,?,1)`)
      .run(year, `${year}-01-01`, 'Synthetic annual plan source');
    return Number(rule.lastInsertRowid);
  }

  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    adoptionKey = 0;
    h.sqlite.exec(`INSERT INTO members
      (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
      VALUES (10001,'synthetic-legacy-admin','Synthetic','Admin','FF','FF',1,1,1)`);
    ruleId = seedYear(YEAR);
    seedYear(2028);
    token = await signJwt(
      {
        sub: ACTOR,
        emp: 'synthetic-legacy-admin',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Admin',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  async function adopt(year = YEAR): Promise<StoredVersion> {
    const captured = await captureBidDefinitionSource(h.env.DB, year);
    if (!captured.ok) throw new Error(JSON.stringify(captured));
    const saved = await saveBidDefinition(h.env.DB, {
      year,
      key: `synthetic-legacy-adopt-${++adoptionKey}`,
      actorSubject: String(ACTOR),
      actorId: ACTOR,
      expected: { kind: 'legacy', sourceToken: captured.sourceToken },
      reason: REASON,
      intent: { operation: 'save', content: captured.content },
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const version = await loadBidDefinitionVersion(
      h.env.DB,
      year,
      String(saved.response.versionId),
    );
    if (!version.ok) throw new Error(JSON.stringify(version));
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    return version;
  }

  function request(path: string, method = 'GET', body?: unknown, key?: string) {
    return app.fetch(
      new Request(`http://x/api/admin/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      h.env,
    );
  }

  function expectedRevisions() {
    const row = h.sqlite
      .prepare(`SELECT y.configuration_revision,b.revision,
      (SELECT revision FROM annual_source_revision WHERE id=1) AS source_revision
      FROM bid_years y JOIN rule_books b ON b.version=y.rule_book_version WHERE y.year=?`)
      .get(YEAR) as {
      configuration_revision: number;
      revision: number;
      source_revision: number;
    };
    return {
      expected_configuration_revision: row.configuration_revision,
      expected_rule_revision: row.revision,
      expected_source_revision: row.source_revision,
    };
  }

  function profileBody(preview: boolean) {
    return {
      ...expectedRevisions(),
      preview,
      reason: REASON,
      profiles: [
        {
          id: 'synthetic-department',
          name: 'Synthetic department requirements',
          sourceRef: 'synthetic-only',
          scope: { kind: 'department' },
          requirements: { credentials: [], custom: [] },
          scoring: { v: 1, total: [], so: [], mo: [] },
          tieBreakChain: ['rsc_seniority'],
        },
      ],
    };
  }

  function ruleBody() {
    return {
      notes: 'Synthetic changed note',
      reason_code: REASON_CODE,
      reason: REASON,
      expected_rule_book_revision: expectedRevisions().expected_rule_revision,
    };
  }

  async function expectBlocked(response: Response, bytes: Buffer) {
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'bid_definition_managed' });
    deepStrictEqual(h.sqlite.serialize(), bytes);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  }

  const legacyTargets: LegacyBidWriteTarget[] = [
    { kind: 'year', year: YEAR },
    { kind: 'book', version: BOOK },
    { kind: 'template', version: BOOK },
    { kind: 'document', id: DOCUMENT },
  ];
  it.each(legacyTargets)(
    'guards former legacy $kind identity after real adoption',
    async (target) => {
      expect(await findManagedLegacyBidWrite(h.env.DB, target)).toBeNull();
      const allowed = legacyBidWriteCondition(target);
      expect(
        h.sqlite.prepare(`SELECT (${allowed.sql}) AS allowed`).get(...allowed.parameters),
      ).toEqual({ allowed: 1 });
      const version = await adopt();
      const bytes = h.sqlite.serialize();
      expect(await findManagedLegacyBidWrite(h.env.DB, target)).toMatchObject({
        error: 'bid_definition_managed',
        bid_year: YEAR,
        version_id: version.row.id,
      });
      expect(
        h.sqlite.prepare(`SELECT (${allowed.sql}) AS allowed`).get(...allowed.parameters),
      ).toEqual({ allowed: 0 });
      expect(
        h.sqlite
          .prepare('SELECT rule_book_version,position_template_version FROM bid_years WHERE year=?')
          .get(YEAR),
      ).toEqual({ rule_book_version: BOOK, position_template_version: BOOK });
      deepStrictEqual(h.sqlite.serialize(), bytes);
    },
  );

  it.each(['book', 'template', 'document'] as const)(
    'resolves a managed designation independently from %s effective year',
    async (kind) => {
      await adopt();
      // Direct synthetic legacy inconsistency: both real parents exist and all
      // FK/owned-row seals stay enabled. The target's stored year is 2028, while
      // the managed 2027 legacy designation references it.
      const column =
        kind === 'book'
          ? 'rule_book_version'
          : kind === 'template'
            ? 'position_template_version'
            : 'annual_policy_document_id';
      const value = kind === 'document' ? 'synthetic-document-2028' : '2028.1';
      h.sqlite.prepare(`UPDATE bid_years SET ${column}=? WHERE year=?`).run(value, YEAR);
      const target: LegacyBidWriteTarget =
        kind === 'document' ? { kind, id: value } : { kind, version: value };
      const bytes = h.sqlite.serialize();
      expect(await findManagedLegacyBidWrite(h.env.DB, target)).toMatchObject({
        error: 'bid_definition_managed',
        bid_year: YEAR,
      });
      const condition = legacyBidWriteCondition(target);
      expect(
        h.sqlite.prepare(`SELECT (${condition.sql}) AS allowed`).get(...condition.parameters),
      ).toEqual({ allowed: 0 });
      deepStrictEqual(h.sqlite.serialize(), bytes);
    },
  );

  it('keeps predecessor private material protected and permits a second facade save', async () => {
    const first = await adopt();
    const saved = await saveBidDefinition(h.env.DB, {
      year: YEAR,
      key: 'synthetic-facade-save-2',
      actorSubject: String(ACTOR),
      actorId: ACTOR,
      expected: { kind: 'version', versionId: first.row.id, revision: 1, sha256: first.sha256 },
      reason: REASON,
      intent: {
        operation: 'save',
        content: {
          ...first.content,
          notes: { ...first.content.notes, bid: 'Synthetic second version' },
        },
      },
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    expect(saved.response).toMatchObject({ changed: true, versionNumber: 2 });
    expect(saved.response.versionId).not.toBe(first.row.id);
    const targets: LegacyBidWriteTarget[] = [
      { kind: 'book', version: first.row.rule_book_version },
      { kind: 'template', version: first.row.position_template_version },
      { kind: 'document', id: String(first.row.policy_document_id) },
    ];
    const bytes = h.sqlite.serialize();
    for (const target of targets) {
      expect(await findManagedLegacyBidWrite(h.env.DB, target)).toMatchObject({
        error: 'bid_definition_managed',
        version_id: saved.response.versionId,
      });
    }
    expect((await loadBidDefinitionVersion(h.env.DB, YEAR, first.row.id)).ok).toBe(true);
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it.each([null, 'synthetic-audit-session'] as const)(
    'rolls back an earlier write when the immediately preceding write is suppressed (session=%s)',
    async (sessionId) => {
      if (sessionId)
        h.sqlite
          .prepare(`INSERT INTO bid_sessions(id,bid_year,is_mock,started_at,current_phase)
      VALUES (?,2027,1,1,'not_started')`)
          .run(sessionId);
      await adopt();
      const bytes = h.sqlite.serialize();
      await expect(
        h.env.DB.batch([
          h.env.DB.prepare('UPDATE position_rules SET notes=? WHERE id=?').bind(
            'Synthetic forbidden change',
            ruleId,
          ),
          h.env.DB.prepare('UPDATE position_rules SET notes=? WHERE id=-1').bind(
            'No matching synthetic row',
          ),
          auditInsertStatement(
            h.env.DB,
            {
              bidSessionId: sessionId,
              actorType: 'admin',
              actorId: ACTOR,
              action: 'override_rule',
              targetKind: 'position_rule',
              targetId: String(ruleId),
              reason: REASON,
            },
            new Date(),
            true,
            legacyBidWriteCondition({ kind: 'book', version: BOOK }),
          ),
        ]),
      ).rejects.toThrow(/NOT NULL.*actor_type/i);
      deepStrictEqual(h.sqlite.serialize(), bytes);
    },
  );

  it('retains normal conditional audit suppression for an unmanaged no-op', async () => {
    const bytes = h.sqlite.serialize();
    const results = await h.env.DB.batch([
      h.env.DB.prepare('UPDATE position_rules SET notes=? WHERE id=-1').bind('No synthetic row'),
      auditInsertStatement(
        h.env.DB,
        {
          bidSessionId: null,
          actorType: 'admin',
          actorId: ACTOR,
          action: 'override_rule',
          reason: REASON,
        },
        new Date(),
        true,
        legacyBidWriteCondition({ kind: 'year', year: YEAR }),
      ),
    ]);
    expect(results.map((result) => result.meta.changes)).toEqual([0, 0]);
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  function action(name: string) {
    const revisions = expectedRevisions();
    const dates = {
      effective_on: '2027-01-01',
      credential_evaluation_on: '2027-01-01',
      expected_duration_days: 2,
      turn_timer_seconds: 180,
      reason: REASON,
    };
    const key = `synthetic-managed-${name}`;
    switch (name) {
      case 'annual-start':
        return request('annual-plan', 'POST', { year: YEAR, ...dates }, key);
      case 'annual-adopt':
        return request(
          'annual-plan/2027/adopt',
          'POST',
          { ...dates, ...revisions, accept_existing_draft: true },
          key,
        );
      case 'annual-seat-remove':
        return request(
          'annual-plan/2027/seats/remove',
          'POST',
          {
            ...revisions,
            position_ids: [SEAT],
            confirm_remove: true,
            evidence_ref: 'Synthetic source',
            reason: REASON,
          },
          key,
        );
      case 'annual-review':
        return request(
          'annual-plan/2027/review',
          'POST',
          { ...revisions, reason: REASON, accept_review: true },
          key,
        );
      case 'annual-profiles':
        return request('annual-plan/2027/profiles', 'POST', profileBody(false), key);
      case 'annual-freeze':
        return request(
          'annual-plan/2027/freeze',
          'POST',
          {
            ...revisions,
            reason: REASON,
            mock_session_id: 'synthetic-unstarted-mock',
            accept_review: true,
          },
          key,
        );
      case 'annual-successor':
        return request(
          'annual-plan/2027/successor',
          'POST',
          { ...dates, ...revisions, accept_successor: true },
          key,
        );
      case 'configuration':
        return request('bid-configuration/2027', 'PUT', {
          rule_book_version: BOOK,
          expected_configuration_revision: revisions.expected_configuration_revision,
          settings: {
            expected_duration_days: 3,
            turn_timer_seconds: 120,
            credential_evaluation_on: '2027-01-01',
          },
          reason: REASON,
        });
      case 'rule-create':
        return request('rule-books', 'POST', { effective_year: YEAR, reason: REASON });
      case 'rule-clone':
        return request('rule-books', 'POST', {
          effective_year: YEAR,
          clone_from: BOOK,
          reason: REASON,
        });
      case 'participation':
        return request(`rule-books/${BOOK}/position-participation/${SEAT}`, 'PUT', {
          template_version: BOOK,
          bid_participation: 'ADMIN_ASSIGNED_NON_BIDDABLE',
          authoritative_source_ref: 'Synthetic participation source',
          reason_code: REASON_CODE,
          reason: REASON,
        });
      case 'rule-publish':
        return request(`rule-books/${BOOK}/publish`, 'POST', { reason: REASON });
      case 'rule-patch':
        return request(`rules/${ruleId}`, 'PATCH', ruleBody(), key);
      case 'rule-delete':
        return request(
          `rules/${ruleId}`,
          'DELETE',
          {
            expected_rule_book_revision: revisions.expected_rule_revision,
            reason_code: REASON_CODE,
            reason: REASON,
          },
          key,
        );
      case 'document-create':
        return request(
          'annual-policy-documents/2027',
          'POST',
          {
            rule_book_version: BOOK,
            policy_text: 'Synthetic changed policy document for boundary verification only.',
            execution_policy: policyFor(SEAT),
            expected_configuration_revision: revisions.expected_configuration_revision,
            expected_rule_book_revision: revisions.expected_rule_revision,
            expected_source_revision: revisions.expected_source_revision,
            reason: REASON,
          },
          key,
        );
      case 'document-publish':
        return request(
          `annual-policy-documents/2027/${DOCUMENT}/publish`,
          'POST',
          {
            expected_configuration_revision: revisions.expected_configuration_revision,
            expected_document_revision: 1,
            reason: REASON,
          },
          key,
        );
      case 'template-clone':
        return request(`positions/clone-from-year/${BOOK}`, 'POST', {
          destVersion: '2027.990',
          destYear: YEAR,
        });
      case 'source-decision':
        return request('source-decisions/2027', 'POST', {
          issue_id: 'synthetic-rule',
          expected_revision: 0,
          title: 'Synthetic rule review',
          question: 'Which synthetic requirement applies?',
          area: 'rules',
          status: 'OPEN',
          decision: 'Synthetic evidence awaits review',
          source_ref: 'Synthetic source document',
          effective_on: '2027-01-01',
        });
      default:
        throw new Error(`Unknown synthetic action ${name}`);
    }
  }

  it.each([
    'annual-start',
    'annual-adopt',
    'annual-seat-remove',
    'annual-review',
    'annual-profiles',
    'annual-freeze',
    'annual-successor',
    'configuration',
    'rule-create',
    'rule-clone',
    'participation',
    'rule-publish',
    'rule-patch',
    'rule-delete',
    'document-create',
    'document-publish',
    'template-clone',
    'source-decision',
  ])(
    'blocks %s against former legacy material with no receipt, audit or material write',
    async (name) => {
      await adopt();
      const bytes = h.sqlite.serialize();
      await expectBlocked(await action(name), bytes);
    },
  );

  it('preserves profile POST preview and legacy history reads after adoption', async () => {
    await adopt();
    const bytes = h.sqlite.serialize();
    const preview = await request('annual-plan/2027/profiles', 'POST', profileBody(true));
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      ok: true,
      compiled: [{ rule: { positionId: SEAT } }],
    });
    for (const path of [
      `rules/${ruleId}`,
      `rules?rule_book_version=${BOOK}`,
      'annual-plan/2027/profiles',
      'source-decisions/2027',
      'annual-policy-documents/2027',
    ]) {
      expect((await request(path)).status).toBe(200);
    }
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it.each(['rule', 'profile'] as const)(
    'replays the successful old %s receipt but rejects a new legacy key',
    async (kind) => {
      const payload = kind === 'rule' ? ruleBody() : profileBody(false);
      const path = kind === 'rule' ? `rules/${ruleId}` : 'annual-plan/2027/profiles';
      const method = kind === 'rule' ? 'PATCH' : 'POST';
      const key = `synthetic-old-${kind}-receipt`;
      const first = await request(path, method, payload, key);
      expect(first.status).toBe(200);
      const receipt = await first.json();
      await adopt();
      const bytes = h.sqlite.serialize();
      const replay = await request(path, method, payload, key);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual({ ...(receipt as object), replayed: true });
      deepStrictEqual(h.sqlite.serialize(), bytes);
      const reused = await request(
        path,
        method,
        { ...payload, reason: 'Synthetic conflicting intent' },
        key,
      );
      expect(reused.status).toBe(409);
      expect(await reused.json()).toMatchObject({ error: 'idempotency_key_reused' });
      deepStrictEqual(h.sqlite.serialize(), bytes);
      await expectBlocked(await request(path, method, payload, `${key}-new`), bytes);
    },
  );

  it('allows unmanaged-year authoring while another year has a head', async () => {
    await adopt();
    for (const target of [
      { kind: 'year', year: 2028 },
      { kind: 'book', version: '2028.1' },
      { kind: 'template', version: '2028.1' },
      { kind: 'document', id: 'synthetic-document-2028' },
    ] satisfies LegacyBidWriteTarget[])
      expect(await findManagedLegacyBidWrite(h.env.DB, target)).toBeNull();
    const managedBefore = h.sqlite
      .prepare('SELECT * FROM bid_definition_versions WHERE bid_year=2027')
      .all();
    const created = await request('rule-books', 'POST', { effective_year: 2028, reason: REASON });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ status: 'draft' });
    const cloned = await request(`positions/clone-from-year/${BOOK}`, 'POST', {
      destVersion: '2028.990',
      destYear: 2028,
    });
    expect(cloned.status).toBe(200);
    expect(await cloned.json()).toMatchObject({ destYear: 2028, copied: 1 });
    expect(
      h.sqlite.prepare('SELECT * FROM bid_definition_versions WHERE bid_year=2027').all(),
    ).toEqual(managedBefore);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['rule-patch', 'configuration', 'rule-create', 'annual-profiles'] as const)(
    'rejects %s when first adoption wins immediately before the write batch',
    async (name) => {
      expect(await findManagedLegacyBidWrite(h.env.DB, { kind: 'year', year: YEAR })).toBeNull();
      const original = h.env.DB.batch.bind(h.env.DB);
      let afterAdoption: Buffer | undefined;
      const intercepted = vi.spyOn(h.env.DB, 'batch').mockImplementationOnce(async (statements) => {
        await adopt();
        afterAdoption = h.sqlite.serialize();
        return original(statements);
      });
      const response = await action(name);
      expect(intercepted).toHaveBeenCalled();
      if (!afterAdoption) throw new Error('Synthetic adoption boundary was not reached');
      await expectBlocked(response, afterAdoption);
    },
  );

  it('blocks Station 6 missing-binding resume after adoption without relying on shape errors', async () => {
    h.sqlite.exec("INSERT INTO bid_years(year,status) VALUES (2026,'configuring')");
    const reconciliation = { reason_code: REASON_CODE, reason: REASON };
    expect(
      (await request('positions/bootstrap-reviewed-2026-source', 'POST', reconciliation)).status,
    ).toBe(201);
    for (const shift of ['A', 'B', 'C']) {
      h.sqlite
        .prepare(`INSERT INTO staffing_positions
        (id,stable_slot_key,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at)
        VALUES (?,?,?,'Division Chief','Division Chief 300','Division Chief','DC','2026-09-03','approved',1,1)`)
        .run(`synthetic-dc-${shift}`, `SYNTHETIC/${shift}/DC`, `${shift} Shift`);
    }
    expect((await request('positions/reconcile-station-six', 'POST', reconciliation)).status).toBe(
      200,
    );
    const clearLegacyBindings = () =>
      h.sqlite
        .prepare('DELETE FROM position_staffing_bindings WHERE template_version=?')
        .run('2026.2');
    clearLegacyBindings();
    const resumed = await request('positions/reconcile-station-six', 'POST', reconciliation);
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ resumed: true });
    expect(
      h.sqlite
        .prepare(
          "SELECT count(*) AS count FROM position_staffing_bindings WHERE template_version='2026.2'",
        )
        .get(),
    ).toEqual({ count: 3 });
    clearLegacyBindings();
    // Keep the real recognized Station 6 target/draft in place. Adopt a separate
    // schema-valid synthetic configuration of that year: the reviewed 2026
    // source itself retains its known decoder rejections and is not fabricated
    // into an approved complete definition merely to make this test pass.
    seedYear(2026, '2026.800');
    await adopt(2026);
    const bytes = h.sqlite.serialize();
    await expectBlocked(
      await request('positions/reconcile-station-six', 'POST', reconciliation),
      bytes,
    );
    await expectBlocked(
      await request('positions/bootstrap-reviewed-2026-source', 'POST', reconciliation),
      bytes,
    );
  });
});
