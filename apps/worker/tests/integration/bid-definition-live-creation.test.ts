import { deepStrictEqual } from 'node:assert';
import {
  type BidDefinitionContent,
  BidDispositionSchema,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { app } from '../../src/index.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import { loadFrozenSessionBidPolicy } from '../../src/lib/bid-policy.js';
import { signJwt } from '../../src/lib/jwt.js';
import { evaluateLiveBidReadiness } from '../../src/lib/live-bid-readiness.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const YEAR = 2027;
const ACTOR = 10001;
type Version = Extract<Awaited<ReturnType<typeof loadBidDefinitionVersion>>, { ok: true }>;

function draftLivePolicy() {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-managed-live-policy',
    stages: [
      {
        id: 'firefighter',
        label: 'Synthetic firefighter stage',
        order: 0,
        memberIds: [ACTOR],
        opportunityPositionIds: ['synthetic-live-seat'],
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

describe('managed Live creation from sealed versions and separate runtime authority', () => {
  let h: TestD1;
  let version: Version;
  let adminToken: string;

  async function token(fresh = true) {
    return signJwt(
      {
        sub: ACTOR,
        emp: 'synthetic-live-admin',
        role: 'admin',
        rank: 'FF',
        first_name: 'Synthetic',
        last_name: 'Administrator',
        fresh_auth_at: Math.floor(Date.now() / 1000) - (fresh ? 0 : 86_400),
      },
      h.env.JWT_SIGNING_KEY,
    );
  }

  async function adoptDraftDefinition() {
    const source = await captureBidDefinitionSource(h.env.DB, YEAR);
    if (!source.ok) throw new Error(JSON.stringify(source));
    const saved = await saveBidDefinition(h.env.DB, {
      year: YEAR,
      key: 'synthetic-live-adopt',
      actorSubject: String(ACTOR),
      actorId: ACTOR,
      expected: { kind: 'legacy', sourceToken: source.sourceToken },
      reason: 'Synthetic saved definition awaiting an explicit publication review',
      intent: { operation: 'save', content: source.content },
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const loaded = await loadBidDefinitionVersion(h.env.DB, YEAR, String(saved.response.versionId));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    return loaded;
  }

  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    const livePolicy = draftLivePolicy();
    h.sqlite.exec(`
      INSERT INTO members
        (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,
         employment_status,employment_status_effective_on,created_at,updated_at)
      VALUES (${ACTOR},'synthetic-live-admin','Synthetic','Administrator','FF','FF',1,0,
        'active','2020-01-01',1,1);
      INSERT INTO position_templates(version,effective_year,notes)
        VALUES ('2027.1',${YEAR},'Synthetic managed Live topology');
      INSERT INTO rule_books(version,effective_year,status,revision,notes)
        VALUES ('2027.1',${YEAR},'draft',2,'Synthetic managed Live rules');
      INSERT INTO bid_years
        (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
      VALUES (${YEAR},'configuring','2027.1','2027.1',3,NULL);
      INSERT INTO positions(id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('synthetic-live-seat','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic firefighter');
      INSERT INTO position_rules
        (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
      VALUES ('2027.1','synthetic-live-seat','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}',
        '{"max":0,"items":[]}','["rsc_seniority"]');
    `);
    const settings = {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      personnelEvaluationOn: '2027-01-01',
      livePolicy,
    };
    h.sqlite
      .prepare('UPDATE bid_years SET config_json=? WHERE year=?')
      .run(JSON.stringify(settings), YEAR);
    h.sqlite
      .prepare(`INSERT INTO annual_bid_policy_documents
        (id,rule_book_version,effective_year,revision,status,policy_text,execution_policy_json,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(
        'synthetic-live-policy-document',
        '2027.1',
        YEAR,
        1,
        'DRAFT',
        'Synthetic policy awaiting the authoritative managed publication review.',
        JSON.stringify(livePolicy),
        ACTOR,
        1,
        1,
      );
    h.sqlite
      .prepare('UPDATE bid_years SET annual_policy_document_id=? WHERE year=?')
      .run('synthetic-live-policy-document', YEAR);
    version = await adoptDraftDefinition();
    adminToken = await token();
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  function request(path: string, body: unknown, options: { auth?: string; key?: string } = {}) {
    return app.fetch(
      new Request(`http://x/api/admin/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.auth ?? adminToken}`,
          ...(options.key === undefined ? {} : { 'Idempotency-Key': options.key }),
        },
        body: JSON.stringify(body),
      }),
      h.env,
    );
  }

  function selection() {
    return { versionId: version.row.id, versionSha256: version.sha256 };
  }

  async function saveRevision(change: (content: BidDefinitionContent) => void) {
    const content = structuredClone(version.content);
    change(content);
    const saved = await saveBidDefinition(h.env.DB, {
      year: YEAR,
      key: `synthetic-live-revision-${version.row.version_number + 1}`,
      actorSubject: String(ACTOR),
      actorId: ACTOR,
      expected: {
        kind: 'version',
        versionId: version.row.id,
        revision: version.row.version_number,
        sha256: version.sha256,
      },
      reason: 'Synthetic independently reviewed runtime policy',
      intent: { operation: 'save', content },
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const loaded = await loadBidDefinitionVersion(h.env.DB, YEAR, String(saved.response.versionId));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    version = loaded;
  }

  async function completeEvidence(change?: (content: BidDefinitionContent) => void) {
    const hash = 'a'.repeat(64);
    h.sqlite.exec(`
      INSERT INTO staffing_positions
        (id,stable_slot_key,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at)
        VALUES ('synthetic-live-staffing','SYNTHETIC/A/7/FF','A','7','Synthetic Engine','Synthetic firefighter','FF','2027-01-01','approved',1,1);
      INSERT INTO staffing_position_source_mappings
        (id,staffing_position_id,source_system,source_locator,source_signature,source_version,source_hash,effective_from,created_at)
        VALUES ('synthetic-live-mapping','synthetic-live-staffing','telestaff',
          '{"v":1,"shift":"A","division":"Combat","station":"7","unit":"Synthetic Engine","position":"Synthetic firefighter"}',
          '${hash}','synthetic-v1','${hash}','2027-01-01',1);
      INSERT INTO assignment_imports
        (id,source_system,source_version,source_hash,source_format,parser_version,source_kind,status,input_row_count,
         normalized_data_row_count,unique_employee_count,report_row_count,structural_row_count,source_snapshot_as_of,created_at)
        VALUES ('synthetic-live-import','telestaff','synthetic-v1','${hash}','TELSTAFF_ASSIGNMENTS_HTML_V1',
          'telestaff-assignments-html@1','official','staged',1,1,1,1,0,'2027-01-01',1);
      INSERT INTO assignment_import_rows
        (id,import_id,source_row_number,row_fingerprint,member_reference_hmac,resolved_member_id,
         staffing_position_source_mapping_id,normalized_source_topology,disposition,reconciliation_classification,review_status,created_at)
        VALUES ('synthetic-live-row','synthetic-live-import',1,'${'b'.repeat(64)}','${'c'.repeat(64)}',${ACTOR},
          'synthetic-live-mapping','{"v":1,"shift":"A","division":"Combat","station":"7","unit":"Synthetic Engine","position":"Synthetic firefighter"}',
          'unchanged','UNCHANGED','not_required',1);
      UPDATE assignment_imports SET status='reviewed' WHERE id='synthetic-live-import';
      UPDATE assignment_imports SET status='approved',approved_at=1,approved_by_member_id=${ACTOR} WHERE id='synthetic-live-import';
      UPDATE assignment_imports SET status='committed',committed_at=1 WHERE id='synthetic-live-import';
      INSERT INTO assignment_observations
        (id,assignment_import_id,assignment_import_row_id,member_id,staffing_position_id,
         staffing_position_source_mapping_id,normalized_source_topology,observed_at,created_at)
        VALUES ('synthetic-live-observation','synthetic-live-import','synthetic-live-row',${ACTOR},'synthetic-live-staffing',
          'synthetic-live-mapping','{"v":1,"shift":"A","division":"Combat","station":"7","unit":"Synthetic Engine","position":"Synthetic firefighter"}',1,1);
      INSERT INTO member_assignments
        (id,member_id,staffing_position_id,origin_type,origin_ref,source_observation_id,status,effective_from,created_at,updated_at)
        VALUES ('synthetic-live-assignment',${ACTOR},'synthetic-live-staffing','TELESTAFF_IMPORT','synthetic-live-import',
          'synthetic-live-observation','active','2027-01-01',1,1);
      INSERT INTO bid_year_staffing_baselines
        (id,bid_year,assignment_import_id,status,accepted_at,accepted_by_member_id,acceptance_reason,created_at)
        VALUES ('synthetic-live-baseline',${YEAR},'synthetic-live-import','accepted',1,${ACTOR},'Synthetic accepted complete baseline',1);
    `);
    // In-memory binding doubles are never connected to remote infrastructure.
    h.env.KV = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
    } as unknown as typeof h.env.KV;
    h.env.R2_AUDIT = { put: vi.fn(async () => null) } as unknown as typeof h.env.R2_AUDIT;
    h.env.R2_EXPORTS = { put: vi.fn(async () => null) } as unknown as typeof h.env.R2_EXPORTS;
    h.env.AUDIT_SIGNING_PRIVKEY = '11'.repeat(32);
    h.env.AUDIT_SIGNING_PUBKEY = '22'.repeat(32);
    h.env.PORTAL_WRITEBACK_ENABLED = 'false';
    h.env.PORTAL_WRITEBACK_BASE_URL = 'https://portal-writeback-disabled.invalid';
    await saveRevision((content) => {
      if (!content.policy || content.settings?.v !== 3)
        throw new Error('Expected V3 synthetic policy');
      const comparator = [{ key: 'RSC_SENIORITY' as const, direction: 'ASC' as const }];
      content.policy.executionPolicy.annualOperations = {
        v: 1,
        stageOrder: ['firefighter'],
        requiredTopologyPositionIds: ['synthetic-live-seat'],
        specialties: [],
        contact: {
          minimumAttempts: 2,
          timingMode: 'OPERATOR_DISCRETION',
          durationSeconds: null,
          evidenceRequired: true,
        },
        aDay: {
          combatGroups: ['G1', 'G2', 'G3', 'G4'],
          min: 1,
          max: 2,
          captainDcMax: 1,
          specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
        },
      };
      content.policy.orderingAuthority = {
        v: 1,
        sourceDecisionId: 'synthetic-live-order',
        comparator,
      };
      content.sourceDecisions = [
        {
          issueId: 'synthetic-live-order',
          title: 'Synthetic approved ordering',
          question: 'Which synthetic comparator applies?',
          area: 'annual-policy',
          status: 'RESOLVED',
          decision: 'Use the synthetic typed RSC comparator.',
          sourceRef: 'synthetic:approved-ordering',
          effectiveOn: '2027-01-01',
          resolution: { v: 1, kind: 'BID_ORDERING_COMPARATOR', comparator },
        },
      ];
      content.settings.livePolicy = structuredClone(content.policy.executionPolicy);
      change?.(content);
    });
  }

  async function preflight() {
    const before = h.sqlite.serialize();
    const response = await request(`bid/${YEAR}/preview`, { kind: 'live', ...selection() });
    expect(response.status, await response.clone().text()).toBe(200);
    const result = (await response.json()) as {
      wouldAllowCreateLive: boolean;
      contextSha256?: string;
      runtimeSourceToken?: string;
      readiness?: { blockingCheckIds: string[] };
      policyError?: string;
    };
    deepStrictEqual(h.sqlite.serialize(), before);
    return result;
  }

  async function creationBody() {
    const preview = await preflight();
    expect(preview.wouldAllowCreateLive, JSON.stringify(preview)).toBe(true);
    if (!preview.contextSha256 || !preview.runtimeSourceToken)
      throw new Error('Synthetic preflight pins missing');
    return {
      ...selection(),
      expectedContextSha256: preview.contextSha256,
      expectedSourceToken: preview.runtimeSourceToken,
    };
  }

  it('rejects legacy mark-mock before any managed Live identity or audit mutation', async () => {
    await completeEvidence();
    const response = await request(`bid/${YEAR}/live-sessions`, await creationBody(), {
      key: 'synthetic-live-boundary',
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    const before = h.sqlite.serialize();
    const rejected = await request(`rehearsal/${created.id}/mark-mock`, {});
    expect({
      status: rejected.status,
      audits: h.sqlite
        .prepare("SELECT count(*) AS n FROM audit_log WHERE action='mark_mock'")
        .get(),
    }).toEqual({ status: 409, audits: { n: 0 } });
    expect(await rejected.json()).toMatchObject({ error: 'canonical_mutation_requires_command' });
    deepStrictEqual(h.sqlite.serialize(), before);
  });

  it.each([false, true])(
    'blocks legacy managed Live controls with canonical start=%s and preserves historical reads',
    async (started) => {
      await completeEvidence();
      const response = await request(`bid/${YEAR}/live-sessions`, await creationBody(), {
        key: 'synthetic-boundary-matrix',
      });
      expect(response.status, await response.clone().text()).toBe(201);
      const { id } = (await response.json()) as { id: string };
      if (started) {
        const start = await request(`bid-session/${id}/start`, {});
        expect(start.status, await start.clone().text()).toBe(200);
        expect(
          h.sqlite
            .prepare('SELECT count(*) AS n FROM canonical_bid_session_state WHERE bid_session_id=?')
            .get(id),
        ).toEqual({ n: 1 });
      }
      const doAccess = vi.fn(() => {
        throw new Error('Legacy boundary must not contact the DO');
      });
      h.env.BID_SESSION = { idFromName: doAccess, get: doAccess } as never;
      const choices = [
        {
          path: 'force-pick',
          body: {
            member_id: ACTOR,
            position_id: 'A101',
            reason_code: 'force.cert_mandate',
            reason: 'Synthetic boundary check',
          },
          command: 'live.force_selection',
        },
        {
          path: 'bid-for-member',
          body: {
            member_id: ACTOR,
            position_id: 'A101',
            reason_code: 'bid_for_member.unreachable_phone',
            reason: 'Synthetic boundary check',
          },
          command: 'live.record_selection',
        },
        {
          path: 'skip',
          body: {
            member_id: ACTOR,
            reason_code: 'skip.declined',
            reason: 'Synthetic boundary check',
          },
          command: 'live.disposition',
        },
        {
          path: 'amend-selection',
          body: {
            bid_id: 'synthetic-award',
            position_id: 'A101',
            expected_session_revision: 0,
            reason: 'Synthetic boundary check',
          },
          command: 'live.amend_selection',
        },
        {
          path: 'lock-position',
          body: {
            member_id: ACTOR,
            position_id: 'A101',
            reason_code: 'lock_position.probationary_placement',
            reason: 'Synthetic boundary check',
          },
        },
        {
          path: 'force-a-day',
          body: { member_id: ACTOR, a_day: 'G1', reason: 'Synthetic boundary check' },
        },
        {
          path: 'pause',
          body: { reason_code: 'session.pause_emergency', reason: 'Synthetic boundary check' },
        },
        { path: 'resume', body: {} },
        {
          path: 'day-end',
          body: { scheduled_resume_at: '2027-02-01T12:00:00Z', reason: 'Synthetic boundary check' },
        },
        { path: 'day-start', body: {} },
      ];
      for (const choice of choices) {
        const before = h.sqlite.serialize();
        const rejected = await request(`bid-session/${id}/${choice.path}`, choice.body);
        expect(rejected.status, `${choice.path}: ${await rejected.clone().text()}`).toBe(409);
        expect(await rejected.json()).toMatchObject(
          'command' in choice
            ? { error: 'canonical_live_command_required', command: choice.command }
            : { error: 'canonical_mutation_requires_command' },
        );
        deepStrictEqual(h.sqlite.serialize(), before);
      }
      const beforeRead = h.sqlite.serialize();
      const historical = await app.fetch(
        new Request(`http://x/api/admin/bid-session/${id}/policy-snapshot`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        }),
        h.env,
      );
      expect(historical.status, await historical.clone().text()).toBe(200);
      deepStrictEqual(h.sqlite.serialize(), beforeRead);
      expect(doAccess).not.toHaveBeenCalled();
    },
  );
  it('reports the missing accepted baseline during Live preview without writing', async () => {
    const before = h.sqlite.serialize();
    const response = await request(`bid/${YEAR}/preview`, { kind: 'live', ...selection() });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      wouldAllowCreateLive: false,
      readiness: {
        blockingCheckIds: expect.arrayContaining([
          'accepted_staffing_baseline',
          'annual_operations_policy',
          'ordering_authority',
          'audit_infrastructure',
          'runtime_bindings',
          'writeback_safety',
        ]),
      },
    });
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_sessions').get()).toEqual({ n: 0 });
    expect(
      h.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_configuration_receipts').get(),
    ).toEqual({
      n: 1,
    });
  });

  it('rejects a creation request and stale step-up before any Live session or receipt is written', async () => {
    const preview = await preflight();
    const body = {
      ...selection(),
      expectedContextSha256: preview.contextSha256,
      expectedSourceToken: preview.runtimeSourceToken,
    };
    const before = h.sqlite.serialize();
    const blocked = await request(`bid/${YEAR}/live-sessions`, body, {
      key: 'synthetic-live-blocked',
    });

    expect(blocked.status, await blocked.clone().text()).toBe(409);
    expect(await blocked.json()).toMatchObject({
      ok: false,
      error: 'readiness_blocked',
      readiness: {
        blockingCheckIds: expect.arrayContaining([
          'accepted_staffing_baseline',
          'ordering_authority',
        ]),
      },
    });
    deepStrictEqual(h.sqlite.serialize(), before);

    const stale = await request(`bid/${YEAR}/live-sessions`, body, {
      auth: await token(false),
      key: 'synthetic-live-stale-step-up',
    });
    expect(stale.status, await stale.clone().text()).toBe(401);
    expect(await stale.json()).toMatchObject({ error: 'step_up_required' });
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_sessions').get()).toEqual({ n: 0 });
    expect(
      h.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_configuration_receipts').get(),
    ).toEqual({
      n: 1,
    });
  });

  it('preflights sealed draft backing and creates only a pinned config session, never a started run', async () => {
    await completeEvidence();
    const body = await creationBody();
    expect(
      h.sqlite
        .prepare('SELECT status FROM rule_books WHERE version=?')
        .get(version.row.rule_book_version),
    ).toEqual({ status: 'draft' });
    expect(
      h.sqlite
        .prepare('SELECT status FROM annual_bid_policy_documents WHERE id=?')
        .get(version.row.policy_document_id),
    ).toEqual({ status: 'DRAFT' });
    const response = await request(`bid/${YEAR}/live-sessions`, body, {
      key: 'synthetic-live-create',
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const created = (await response.json()) as {
      id: string;
      current_phase: string;
      is_mock: boolean;
    };
    expect(created).toMatchObject({ current_phase: 'config', is_mock: false });
    expect(
      h.sqlite
        .prepare('SELECT current_phase,is_mock,current_bidder_id FROM bid_sessions WHERE id=?')
        .get(created.id),
    ).toEqual({ current_phase: 'config', is_mock: 0, current_bidder_id: null });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM canonical_bid_session_state').get()).toEqual(
      { n: 0 },
    );
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bids').get()).toEqual({ n: 0 });
    const frozen = await loadFrozenSessionBidPolicy(getDb(h.env.DB), created.id);
    if (!frozen.ok) throw new Error(JSON.stringify(frozen));
    const originalSnapshot = structuredClone(frozen.snapshot);
    await saveRevision((content) => {
      content.notes.bid = 'Synthetic newer saved head';
      if (!content.settings) throw new Error('Expected saved settings');
      content.settings.turnTimerSeconds = 240;
    });
    const reloaded = await loadFrozenSessionBidPolicy(getDb(h.env.DB), created.id);
    expect(reloaded).toEqual(frozen);
    expect(frozen.snapshot.settings.turnTimerSeconds).toBe(180);
    expect(version.content.settings?.turnTimerSeconds).toBe(240);
    const readiness = await evaluateLiveBidReadiness({
      db: getDb(h.env.DB),
      env: h.env,
      bidSessionId: created.id,
      bidYear: YEAR,
      frozenPolicy: frozen,
      operatorAuthorized: true,
    });
    expect(readiness.canStartLiveBid, JSON.stringify(readiness)).toBe(true);
    expect(frozen.snapshot).toEqual(originalSnapshot);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('requires separately granted creation authority, fresh auth, and audit credentials', async () => {
    await completeEvidence((content) => {
      if (!content.policy || content.settings?.v !== 3) throw new Error('Expected policy');
      content.policy.executionPolicy.actionPermissions =
        content.policy.executionPolicy.actionPermissions.filter(
          (grant) => grant.action !== 'create_live_session',
        );
      content.settings.livePolicy = structuredClone(content.policy.executionPolicy);
    });
    const preview = await preflight();
    expect(preview.wouldAllowCreateLive).toBe(false);
    expect(preview.readiness?.blockingCheckIds).toContain('operator_authorization');
    const denied = await request(
      `bid/${YEAR}/live-sessions`,
      {
        ...selection(),
        expectedContextSha256: preview.contextSha256,
        expectedSourceToken: preview.runtimeSourceToken,
      },
      { key: 'synthetic-live-no-grant' },
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: 'live_action_forbidden' });
    await saveRevision((content) => {
      if (!content.policy || content.settings?.v !== 3) throw new Error('Expected policy');
      content.policy.executionPolicy.actionPermissions = draftLivePolicy().actionPermissions;
      content.settings.livePolicy = structuredClone(content.policy.executionPolicy);
    });
    const body = await creationBody();
    const stale = await request(`bid/${YEAR}/live-sessions`, body, {
      key: 'synthetic-live-auth-stale',
      auth: await token(false),
    });
    expect(stale.status).toBe(401);
    h.env.AUDIT_SIGNING_PRIVKEY = '';
    const missingCredential = await preflight();
    expect(missingCredential.wouldAllowCreateLive).toBe(false);
    expect(missingCredential.readiness?.blockingCheckIds).toContain('audit_infrastructure');
    const before = h.sqlite.serialize();
    const noCredential = await request(`bid/${YEAR}/live-sessions`, body, {
      key: 'synthetic-live-no-audit-key',
    });
    expect(noCredential.status).toBe(409);
    expect(await noCredential.json()).toMatchObject({
      error: 'readiness_blocked',
      readiness: { blockingCheckIds: expect.arrayContaining(['audit_infrastructure']) },
    });
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_sessions').get()).toEqual({ n: 0 });
  });

  it.each(['context', 'source', 'version', 'credentials'] as const)(
    'rejects changed %s pins or evidence before creation',
    async (changed) => {
      await completeEvidence();
      const body = await creationBody();
      if (changed === 'context') body.expectedContextSha256 = 'd'.repeat(64);
      if (changed === 'source') body.expectedSourceToken = 'e'.repeat(64);
      if (changed === 'version') body.versionSha256 = 'f'.repeat(64);
      if (changed === 'credentials')
        h.sqlite.exec(
          `INSERT INTO credentials(id,name) VALUES (9001,'Synthetic changed credential'); INSERT INTO member_credentials(member_id,credential_id,start_date) VALUES (${ACTOR},9001,'2026-01-01');`,
        );
      const before = h.sqlite.serialize();
      const response = await request(`bid/${YEAR}/live-sessions`, body, {
        key: `synthetic-live-changed-${changed}`,
      });
      expect(response.status, await response.clone().text()).toBe(409);
      expect(await response.json()).toMatchObject(
        changed === 'version'
          ? {
              error: 'session_policy_snapshot_unavailable',
              policyError: 'bid_version_hash_mismatch',
            }
          : { error: 'bid_run_context_changed' },
      );
      deepStrictEqual(h.sqlite.serialize(), before);
    },
  );

  it('rejects an unresolved saved policy decision', async () => {
    await completeEvidence((content) => {
      content.sourceDecisions = content.sourceDecisions.map((entry) => ({
        ...entry,
        status: 'OPEN',
      }));
    });
    expect(await preflight()).toMatchObject({
      wouldAllowCreateLive: false,
      policyError: 'policy_source_decision_required',
    });
  });

  it('requires V3 Live policy even though sealed backing is read through the draft-compatible loader', async () => {
    await completeEvidence((content) => {
      content.policy = null;
      content.settings = {
        v: 2,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2027-01-01',
        personnelEvaluationOn: '2027-01-01',
      };
    });
    expect(await preflight()).toMatchObject({
      wouldAllowCreateLive: false,
      policyError: 'bid_configuration_live_policy_required',
    });
  });

  it('blocks a sealed policy that has no independently resolved ordering authority', async () => {
    await completeEvidence((content) => {
      if (!content.policy) throw new Error('Expected policy');
      const { orderingAuthority: _orderingAuthority, ...withoutOrdering } = content.policy;
      content.policy = withoutOrdering;
      content.sourceDecisions = [];
    });
    const preview = await preflight();
    expect(preview.wouldAllowCreateLive).toBe(false);
    expect(preview.readiness?.blockingCheckIds).toContain('ordering_authority');
  });

  it('does not inherit Mock participation concessions from an accepted staffing observation', async () => {
    await completeEvidence();
    h.sqlite.exec(
      `UPDATE members SET employment_status='unknown', employment_status_effective_on=NULL WHERE id=${ACTOR}`,
    );
    const preview = await preflight();
    expect(preview.wouldAllowCreateLive, JSON.stringify(preview)).toBe(false);
    expect(preview.readiness?.blockingCheckIds).toContain('participant_population');
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_sessions').get()).toEqual({ n: 0 });
  });

  it('rejects incomplete explicit participant coverage despite valid sealed material', async () => {
    await completeEvidence((content) => {
      if (!content.policy || content.settings?.v !== 3) throw new Error('Expected policy');
      content.policy.executionPolicy.stages = content.policy.executionPolicy.stages.map(
        (stage) => ({ ...stage, memberIds: [99999] }),
      );
      content.settings.livePolicy = structuredClone(content.policy.executionPolicy);
    });
    const preview = await preflight();
    expect(preview.wouldAllowCreateLive, JSON.stringify(preview)).toBe(false);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_sessions').get()).toEqual({ n: 0 });
  });
});
