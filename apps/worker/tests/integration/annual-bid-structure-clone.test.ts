import {
  BidDispositionSchema,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  type BidDefinitionContent,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { carryForwardBidDefinitionStructure } from '../../src/lib/bid-definition-carry-forward.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const SOURCE_YEAR = 2026;
const TARGET_YEAR = 2027;
const SEAT = 'synthetic-carry-forward-seat';

function policy() {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-saved-structure',
    stages: [
      {
        id: 'ff',
        label: 'Firefighter',
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
}

describe('new annual Bid from saved Current-Bid structure', () => {
  let h: TestD1;
  let token: string;
  let counter: number;

  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    counter = 0;
    h.sqlite.exec(`
      INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,rank_seniority,is_probationary,employment_status,employment_status_effective_on,created_at,updated_at)
      VALUES (10001,'synthetic-carry-admin','Synthetic','Administrator','FF','FF',1,1,0,'active','2020-01-01',1,1);
      INSERT INTO position_templates(version,effective_year) VALUES ('2026.carry',2026);
      INSERT INTO rule_books(version,effective_year,status,revision) VALUES ('2026.carry',2026,'draft',0);
      INSERT INTO bid_years(year,status,rule_book_version,position_template_version,configuration_revision,config_json)
      VALUES (2026,'configuring','2026.carry','2026.carry',1,
        '{"v":2,"expectedDurationDays":3,"turnTimerSeconds":180,"credentialEvaluationOn":"2026-10-05","personnelEvaluationOn":"2026-10-05"}');
      INSERT INTO positions(id,template_version,shift,station,division,unit,rank_required,position_name)
      VALUES ('${SEAT}','2026.carry','A','7','Combat','Synthetic Engine','FF','Synthetic firefighter');
      INSERT INTO position_rules(rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
      VALUES ('2026.carry','${SEAT}','2026.carry','{"rank":["FF"],"credentials":[],"custom":[]}','{"max":0,"items":[]}','["rsc_seniority"]');
      INSERT INTO rule_book_position_participation(rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
      VALUES ('2026.carry','${SEAT}','2026.carry','BIDDABLE','Synthetic source',1);
      UPDATE rule_books SET status='active' WHERE version='2026.carry';
    `);
    token = await signJwt(
      {
        sub: 10001,
        emp: 'synthetic-carry-admin',
        role: 'admin',
        rank: 'FF',
        first_name: 'Synthetic',
        last_name: 'Administrator',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
  });

  afterEach(async () => teardownTestD1(h));

  async function request(path: string, body?: unknown, key?: string) {
    return app.fetch(
      new Request(`http://x/api/admin/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
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

  async function saveSource() {
    const current = await request(`bid/${SOURCE_YEAR}/current`);
    expect(current.status, await current.clone().text()).toBe(200);
    const baseline = (await current.json()) as {
      content: BidDefinitionContent;
      expected: unknown;
    };
    const execution = policy();
    const content = structuredClone(baseline.content);
    content.settings = {
      v: 3,
      expectedDurationDays: 3,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2026-10-05',
      personnelEvaluationOn: '2026-10-05',
      livePolicy: execution,
    };
    content.policy = { policyText: 'Synthetic saved policy language.', executionPolicy: execution };
    const saved = await request(
      `bid/${SOURCE_YEAR}/versions`,
      { expected: baseline.expected, content, reason: 'Save synthetic reusable Bid structure.' },
      `synthetic-source-save-${++counter}`,
    );
    expect(saved.status, await saved.clone().text()).toBe(201);
    return { ...(await saved.json() as { versionId: string; contentSha256: string }), content };
  }

  it('seeds a separate target year, clears people and authority, and replays safely', async () => {
    const source = await saveSource();
    const draft = carryForwardBidDefinitionStructure({
      source: source.content,
      sourceVersionId: source.versionId,
      targetYear: TARGET_YEAR,
      personnelEvaluationOn: '2027-10-05',
      credentialEvaluationOn: '2027-10-05',
      expectedDurationDays: 3,
      turnTimerSeconds: 180,
    });
    const undefinedPaths = (value: unknown, path = '$'): string[] => {
      if (value === undefined) return [path];
      if (Array.isArray(value)) return value.flatMap((entry, index) => undefinedPaths(entry, `${path}[${index}]`));
      if (value && typeof value === 'object')
        return Object.entries(value).flatMap(([key, entry]) => undefinedPaths(entry, `${path}.${key}`));
      return [];
    };
    expect(undefinedPaths(draft)).toEqual([]);
    const body = {
      source_year: SOURCE_YEAR,
      source_version_id: source.versionId,
      source_version_sha256: source.contentSha256,
      target_year: TARGET_YEAR,
      effective_on: '2027-10-05',
      credential_evaluation_on: '2027-10-05',
      expected_duration_days: 3,
      turn_timer_seconds: 180,
      reason: 'Start reviewed 2027 annual structure from the saved 2026 Bid.',
      accept_carry_forward: true,
    };
    const first = await request('annual-plan/from-bid-definition', body, 'synthetic-carry-forward');
    expect(first.status, await first.clone().text()).toBe(201);
    const response = (await first.json()) as {
      targetYear: number;
      replayed: boolean;
      bidDefinition: { versionNumber: number };
    };
    expect(response).toMatchObject({ targetYear: TARGET_YEAR, replayed: false, bidDefinition: { versionNumber: 1 } });

    const target = await request(`bid/${TARGET_YEAR}/current`);
    expect(target.status, await target.clone().text()).toBe(200);
    const current = (await target.json()) as { content: BidDefinitionContent; state: string };
    expect(current.state).toBe('VERSIONED');
    expect(current.content).toMatchObject({
      bidYear: TARGET_YEAR,
      settings: { v: 2, personnelEvaluationOn: '2027-10-05', credentialEvaluationOn: '2027-10-05' },
      policy: null,
      pendingPolicy: {
        executionPolicy: {
          stages: [{ id: 'ff', memberIds: [] }],
          actionPermissions: expect.arrayContaining([
            expect.objectContaining({ action: 'record_selection', actorMemberIds: [] }),
          ]),
        },
      },
    });
    expect(current.content.positions.map((position) => position.id)).toEqual([SEAT]);
    expect(h.sqlite.prepare('SELECT count(*) AS n FROM bid_sessions WHERE bid_year=?').get(TARGET_YEAR)).toEqual({
      n: 0,
    });
    expect(h.sqlite.prepare('SELECT count(*) AS n FROM bid_definition_versions WHERE bid_year=?').get(TARGET_YEAR)).toEqual({
      n: 1,
    });

    const replay = await request('annual-plan/from-bid-definition', body, 'synthetic-carry-forward');
    expect(replay.status, await replay.clone().text()).toBe(200);
    expect(await replay.json()).toEqual({ ...response, replayed: true });
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('fails closed when the selected saved source no longer matches, without creating a target year', async () => {
    const source = await saveSource();
    const body = {
      source_year: SOURCE_YEAR,
      source_version_id: source.versionId,
      source_version_sha256: 'b'.repeat(64),
      target_year: 2028,
      effective_on: '2028-10-05',
      credential_evaluation_on: '2028-10-05',
      expected_duration_days: 3,
      turn_timer_seconds: 180,
      reason: 'Reject a stale immutable source before creating a target annual Bid.',
      accept_carry_forward: true,
    };

    const response = await request('annual-plan/from-bid-definition', body, 'stale-carry-forward');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'saved_source_bid_version_unavailable' });
    expect(h.sqlite.prepare('SELECT count(*) AS n FROM bid_years WHERE year=2028').get()).toEqual({ n: 0 });
    expect(
      h.sqlite
        .prepare("SELECT count(*) AS n FROM annual_plan_receipts WHERE idempotency_key='stale-carry-forward'")
        .get(),
    ).toEqual({ n: 0 });
    expect(h.sqlite.prepare('SELECT count(*) AS n FROM annual_bid_structure_clone_state WHERE target_year=2028').get()).toEqual({
      n: 0,
    });
  });
});
