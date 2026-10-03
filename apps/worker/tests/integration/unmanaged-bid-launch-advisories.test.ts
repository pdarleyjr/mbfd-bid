import { deepStrictEqual } from 'node:assert';
import type { BidLaunchReview } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const YEAR = 2029;
const ACTOR = 99;
const BIDDER = 61;
const ALIAS = 'synthetic-unmanaged-launch';
const KEY = 'a'.repeat(64);
type Mode = 'mock' | 'live';
type Preview = {
  dry_run: true;
  bid_year: number;
  mode: Mode;
  is_mock: boolean;
  would_allow_start: boolean;
  readiness: { canStartLiveBid: boolean; blockingCheckIds: string[] } | null;
  launchReview: BidLaunchReview;
};

describe('operator-controlled unmanaged legacy launch through normal admin routes', () => {
  let h: TestD1;
  let env: WorkerEnv;

  async function token(role: 'admin' | 'member' = 'admin') {
    return signJwt(
      {
        sub: ACTOR,
        emp: 'synthetic-launch-operator',
        role,
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Operator',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      KEY,
    );
  }

  async function request(
    path: string,
    body?: unknown,
    options: {
      role?: 'admin' | 'member';
      authenticated?: boolean;
      environment?: WorkerEnv;
      method?: 'GET' | 'POST';
    } = {},
  ) {
    return app.fetch(
      new Request(`http://test/api/admin/bid-session${path}`, {
        method: options.method ?? (body === undefined ? 'GET' : 'POST'),
        headers: {
          ...(options.authenticated === false
            ? {}
            : { Authorization: `Bearer ${await token(options.role)}` }),
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      options.environment ?? env,
    );
  }

  function addOpenQuestion(issueId: string) {
    h.sqlite
      .prepare(`INSERT INTO bid_source_decisions
        (bid_year,issue_id,revision,title,question,area,status,decision,source_ref,effective_on,actor_subject,created_at)
        VALUES (?,?,1,'Synthetic missing source fact','What is the missing fact?','annual-policy','OPEN',
          'Keep the fact unknown; use a reviewed operator choice.','Synthetic fixture only.','2029-01-01','99',1)`)
      .run(YEAR, issueId);
  }

  async function preview(mode?: Mode): Promise<Preview> {
    const before = h.sqlite.serialize();
    const response = await request('/readiness-preview', {
      bid_year: YEAR,
      ...(mode === undefined ? {} : { mode }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const result = (await response.json()) as Preview;
    deepStrictEqual(h.sqlite.serialize(), before);
    return result;
  }

  function unchangedSourceState() {
    return {
      rules: h.sqlite.prepare('SELECT version,status,revision FROM rule_books').all(),
      policy: h.sqlite
        .prepare(
          'SELECT id,status,policy_text,execution_policy_json FROM annual_bid_policy_documents',
        )
        .all(),
      questions: h.sqlite.prepare('SELECT * FROM bid_source_decisions ORDER BY issue_id').all(),
      credentials: h.sqlite.prepare('SELECT * FROM member_credentials').all(),
    };
  }

  beforeEach(async () => {
    h = await setupTestD1();
    env = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      PORTAL_WRITEBACK_ENABLED: 'false',
      PORTAL_WRITEBACK_BASE_URL: 'https://portal-writeback-disabled.invalid',
      AUDIT_SIGNING_PRIVKEY: 'synthetic-private-key',
      AUDIT_SIGNING_PUBKEY: 'synthetic-public-key',
      KV: { get: async () => null, put: async () => undefined } as never,
      R2_AUDIT: { put: async () => undefined } as never,
      R2_EXPORTS: { put: async () => undefined } as never,
    };
    const policy = {
      v: 1,
      policyRevision: 'synthetic-unmanaged-launch-v1',
      stages: [
        {
          id: 'ordinary',
          label: 'Ordinary picks',
          order: 0,
          memberIds: [BIDDER],
          opportunityPositionIds: ['synthetic-seat'],
          kind: 'MIXED',
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
      ].map((action) => ({
        action,
        actorMemberIds: [ACTOR],
      })),
      specialtyCatalogReference: null,
      aDayPolicyReference: null,
      transitionPolicyReference: null,
      publicationPolicyReference: null,
    };
    h.sqlite.exec(`INSERT INTO members
      (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,
        employment_status,employment_status_effective_on,created_at,updated_at)
      VALUES (99,'synthetic-launch-operator','Synthetic','Operator','CHIEF','EXCLUDED',0,0,'inactive','2020-01-01',1,1),
        (61,'synthetic-launch-bidder','Synthetic','Bidder','FF','FF',1,0,'active','2020-01-01',1,1);`);
    h.sqlite
      .prepare('INSERT INTO position_templates(version,effective_year) VALUES (?,?)')
      .run(ALIAS, YEAR);
    h.sqlite
      .prepare("INSERT INTO rule_books(version,effective_year,status) VALUES (?,?,'draft')")
      .run(ALIAS, YEAR);
    h.sqlite
      .prepare(`INSERT INTO positions(id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('synthetic-seat',?,'A','1','Combat','Synthetic Engine','FF','Synthetic Firefighter')`)
      .run(ALIAS);
    h.sqlite
      .prepare(`INSERT INTO position_rules
        (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES (?,'synthetic-seat',?,'{"rank":["FF"],"credentials":[],"custom":[]}',
          '{"max":0,"items":[]}','["rsc_seniority"]')`)
      .run(ALIAS, ALIAS);
    h.sqlite
      .prepare(`INSERT INTO annual_bid_policy_documents
        (id,rule_book_version,effective_year,revision,status,policy_text,execution_policy_json,created_by,created_at,updated_at)
        VALUES ('synthetic-policy',?,?,1,'DRAFT','Synthetic launch fixture; no adopted policy claim.',?,99,1,1)`)
      .run(ALIAS, YEAR, JSON.stringify(policy));
    h.sqlite
      .prepare(`INSERT INTO bid_years
        (year,status,rule_book_version,position_template_version,config_json,configuration_revision,annual_policy_document_id)
        VALUES (?,'configuring',?,?,?,1,'synthetic-policy')`)
      .run(
        YEAR,
        ALIAS,
        ALIAS,
        JSON.stringify({
          v: 3,
          expectedDurationDays: 2,
          turnTimerSeconds: 180,
          credentialEvaluationOn: '2029-01-15',
          personnelEvaluationOn: '2029-01-15',
          livePolicy: policy,
        }),
      );
    addOpenQuestion('synthetic-open-question');
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('defaults the legacy preview to Real while reporting publication advisories without writes', async () => {
    const result = await preview();
    expect(result).toMatchObject({
      dry_run: true,
      bid_year: YEAR,
      mode: 'live',
      is_mock: false,
      would_allow_start: true,
      readiness: { canStartLiveBid: true, blockingCheckIds: [] },
      launchReview: { requiresAcknowledgement: true },
    });
    expect(result.launchReview.advisories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'source_decisions', affectedCount: 1 }),
        expect.objectContaining({ code: 'annual_policy_not_published' }),
        expect.objectContaining({ code: 'rule_book_not_active' }),
      ]),
    );
    expect(h.sqlite.prepare('SELECT count(*) AS n FROM bid_sessions').get()).toEqual({ n: 0 });
  });

  for (const mode of ['mock', 'live'] as const) {
    it(`${mode}: exact acknowledgement creates, reloads and starts without resolving source facts`, async () => {
      const reviewed = await preview(mode);
      expect(reviewed).toMatchObject({
        mode,
        is_mock: mode === 'mock',
        would_allow_start: true,
        ...(mode === 'mock' ? { readiness: null } : {}),
      });
      const sourceBefore = unchangedSourceState();
      for (const [acknowledgement, error] of [
        [undefined, 'launch_acknowledgement_required'],
        [{ advisorySha256: 'f'.repeat(64) }, 'launch_review_changed'],
      ] as const) {
        const before = h.sqlite.serialize();
        const rejected = await request('', {
          bid_year: YEAR,
          mode,
          ...(acknowledgement === undefined ? {} : { launchAcknowledgement: acknowledgement }),
        });
        expect(rejected.status, await rejected.clone().text()).toBe(409);
        expect(await rejected.json()).toMatchObject({ error });
        deepStrictEqual(h.sqlite.serialize(), before);
      }
      const createdResponse = await request('', {
        bid_year: YEAR,
        mode,
        expected_configuration_revision: 1,
        expected_rule_revision: 0,
        launchAcknowledgement: { advisorySha256: reviewed.launchReview.advisorySha256 },
      });
      expect(createdResponse.status, await createdResponse.clone().text()).toBe(201);
      const created = (await createdResponse.json()) as {
        id: string;
        launchReview: BidLaunchReview;
        launchAcknowledged: boolean;
      };
      expect(created).toMatchObject({
        launchReview: reviewed.launchReview,
        launchAcknowledged: true,
      });
      const frozen = h.sqlite
        .prepare('SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id=?')
        .get(created.id);
      const reloaded = await request(`/${created.id}/readiness`);
      expect(reloaded.status, await reloaded.clone().text()).toBe(200);
      expect(await reloaded.json()).toMatchObject({
        launchReview: reviewed.launchReview,
        launchAcknowledged: true,
      });
      const beforeInvalidStart = h.sqlite.serialize();
      const invalidStart = await request(`/${created.id}/start`, { bypassEverything: true });
      expect(invalidStart.status).toBe(400);
      expect(await invalidStart.json()).toEqual({ error: 'invalid_launch_request' });
      deepStrictEqual(h.sqlite.serialize(), beforeInvalidStart);
      const badStartDigest = await request(`/${created.id}/start`, {
        launchAcknowledgement: { advisorySha256: 'e'.repeat(64) },
      });
      expect(badStartDigest.status).toBe(409);
      expect(await badStartDigest.json()).toMatchObject({ error: 'launch_review_changed' });
      deepStrictEqual(h.sqlite.serialize(), beforeInvalidStart);
      const started = await request(`/${created.id}/start`, mode === 'mock' ? undefined : {}, {
        method: 'POST',
      });
      expect(started.status, await started.clone().text()).toBe(200);
      expect(await started.json()).toMatchObject({
        id: created.id,
        current_phase: 'position_bid',
        bid_order_count: 1,
        launchReview: reviewed.launchReview,
        launchAcknowledged: true,
      });
      expect(unchangedSourceState()).toEqual(sourceBefore);
      expect(
        h.sqlite
          .prepare('SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id=?')
          .get(created.id),
      ).toEqual(frozen);
      expect(
        h.sqlite
          .prepare('SELECT member_id,stage_id FROM bid_order WHERE bid_session_id=?')
          .all(created.id),
      ).toEqual([{ member_id: BIDDER, stage_id: 'ordinary' }]);
      expect(
        h.sqlite
          .prepare(
            "SELECT after_state FROM audit_log WHERE bid_session_id=? AND action='session_start' ORDER BY seq",
          )
          .all(created.id),
      ).toHaveLength(2);
    });

    it(`${mode}: changed source or cross-mode digest cannot acknowledge a different review`, async () => {
      const reviewed = await preview(mode);
      const otherMode = await preview(mode === 'mock' ? 'live' : 'mock');
      expect(otherMode.launchReview.advisorySha256).not.toBe(reviewed.launchReview.advisorySha256);
      addOpenQuestion('synthetic-new-question');
      const before = h.sqlite.serialize();
      for (const digest of [
        reviewed.launchReview.advisorySha256,
        otherMode.launchReview.advisorySha256,
      ]) {
        const rejected = await request('', {
          bid_year: YEAR,
          mode,
          launchAcknowledgement: { advisorySha256: digest },
        });
        expect(rejected.status, await rejected.clone().text()).toBe(409);
        expect(await rejected.json()).toMatchObject({ error: 'launch_review_changed' });
        deepStrictEqual(h.sqlite.serialize(), before);
      }
    });

    it(`${mode}: valid advisory acknowledgement does not bypass administrator authentication`, async () => {
      const reviewed = await preview(mode);
      const body = {
        bid_year: YEAR,
        mode,
        launchAcknowledgement: { advisorySha256: reviewed.launchReview.advisorySha256 },
      };
      const before = h.sqlite.serialize();
      const anonymous = await request('', body, { authenticated: false });
      expect(anonymous.status).toBe(401);
      const member = await request('', body, { role: 'member' });
      expect(member.status).toBe(403);
      deepStrictEqual(h.sqlite.serialize(), before);
    });

    for (const invalidSource of ['malformed-settings', 'archived-rule-book'] as const) {
      it(`${mode}: ${invalidSource} remains a hard source failure`, async () => {
        const reviewed = await preview(mode);
        if (invalidSource === 'malformed-settings')
          h.sqlite.prepare('UPDATE bid_years SET config_json=? WHERE year=?').run('{"v":3}', YEAR);
        else h.sqlite.prepare("UPDATE rule_books SET status='archived' WHERE version=?").run(ALIAS);
        const before = h.sqlite.serialize();
        const rejectedPreview = await request('/readiness-preview', { bid_year: YEAR, mode });
        expect(rejectedPreview.status).toBe(200);
        expect(await rejectedPreview.json()).toMatchObject({
          would_allow_start: false,
          error: 'session_policy_snapshot_unavailable',
        });
        const rejectedCreate = await request('', {
          bid_year: YEAR,
          mode,
          launchAcknowledgement: { advisorySha256: reviewed.launchReview.advisorySha256 },
        });
        expect(rejectedCreate.status, await rejectedCreate.clone().text()).toBe(409);
        expect(await rejectedCreate.json()).toMatchObject({
          error: 'session_policy_snapshot_unavailable',
        });
        deepStrictEqual(h.sqlite.serialize(), before);
      });
    }

    it(`${mode}: a managed head keeps legacy preview and creation unavailable`, async () => {
      const source = await captureBidDefinitionSource(env.DB, YEAR);
      if (!source.ok) throw new Error(JSON.stringify(source));
      const saved = await saveBidDefinition(env.DB, {
        year: YEAR,
        key: `synthetic-adopt-${mode}`,
        actorSubject: String(ACTOR),
        actorId: ACTOR,
        expected: { kind: 'legacy', sourceToken: source.sourceToken },
        reason: 'Synthetic test adoption; no production operation.',
        intent: { operation: 'save', content: source.content },
      });
      if (!saved.ok) throw new Error(JSON.stringify(saved));
      const before = h.sqlite.serialize();
      const previewResponse = await request('/readiness-preview', { bid_year: YEAR, mode });
      expect(previewResponse.status).toBe(200);
      expect(await previewResponse.json()).toMatchObject({
        error: 'managed_bid_version_required',
        would_allow_start: false,
      });
      const createResponse = await request('', { bid_year: YEAR, mode });
      expect(createResponse.status).toBe(409);
      expect(await createResponse.json()).toMatchObject({ error: 'managed_bid_version_required' });
      deepStrictEqual(h.sqlite.serialize(), before);
    });
  }

  it('Real runtime and writeback failures remain hard checks despite source advisories', async () => {
    const reviewed = await preview('live');
    for (const changedEnvironment of [
      { ...env, R2_AUDIT: {} as never },
      { ...env, PORTAL_WRITEBACK_ENABLED: 'true' as const },
    ]) {
      const before = h.sqlite.serialize();
      const rejected = await request(
        '',
        {
          bid_year: YEAR,
          mode: 'live',
          launchAcknowledgement: { advisorySha256: reviewed.launchReview.advisorySha256 },
        },
        { environment: changedEnvironment },
      );
      expect(rejected.status, await rejected.clone().text()).toBe(409);
      expect(await rejected.json()).toMatchObject({ error: 'readiness_blocked' });
      deepStrictEqual(h.sqlite.serialize(), before);
    }
  });
});
