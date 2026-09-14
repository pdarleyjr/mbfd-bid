import { deepStrictEqual } from 'node:assert';
import { BidDispositionSchema, FrozenLiveBidPolicySchema, LiveBidActionSchema } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import { signJwt } from '../../src/lib/jwt.js';
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

describe('managed Live creation remains fail-closed pending an authoritative publication lifecycle', () => {
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

  it('reports the sealed draft publication blocker during Live preview without writing', async () => {
    const before = h.sqlite.serialize();
    const response = await request(`bid/${YEAR}/preview`, { kind: 'live', ...selection() });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      wouldAllowCreateLive: false,
      policyError: 'bid_configuration_annual_policy_document_invalid',
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
    const body = {
      ...selection(),
      expectedContextSha256: 'a'.repeat(64),
      expectedSourceToken: 'b'.repeat(64),
    };
    const before = h.sqlite.serialize();
    const blocked = await request(`bid/${YEAR}/live-sessions`, body, {
      key: 'synthetic-live-blocked',
    });

    expect(blocked.status, await blocked.clone().text()).toBe(409);
    expect(await blocked.json()).toMatchObject({
      ok: false,
      error: 'session_policy_snapshot_unavailable',
      policyError: 'bid_configuration_annual_policy_document_invalid',
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
});
