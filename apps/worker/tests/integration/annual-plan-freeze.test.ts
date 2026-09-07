import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BidSessionState } from '../../src/durable/bid-session-state.js';
import { app } from '../../src/index.js';
import { freezeAnnualPlan, validRehearsalCompletion } from '../../src/lib/annual-plan-freeze.js';
import { signJwt } from '../../src/lib/jwt.js';
import { syntheticAnnualCompletionSource } from '../fixtures/synthetic-annual-completion.js';
import { seedAuthoritativeBaseline } from './helpers/authoritative-staffing-baseline.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('atomic annual freeze with synthetic completed Mock evidence', () => {
  let h: TestD1;
  let token: string;
  let book: string;
  let mockId: string;
  let documentId: string;
  const request = (path: string, body?: unknown, key?: string) =>
    app.fetch(
      new Request(`http://x/api/admin/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      h.env,
    );
  it('creates one Mock and frozen snapshot per reviewed request, including lost responses and rolled-back receipt failures', async () => {
    const { plan } = (await (await request('annual-plan/2027')).json()) as {
      plan: { ruleBookRevision: number; configurationRevision: number; sourceRevision: number };
    };
    const body = {
      bid_year: 2027,
      mode: 'mock',
      expected_rule_revision: plan.ruleBookRevision,
      expected_configuration_revision: plan.configurationRevision,
      expected_source_revision: plan.sourceRevision,
    };
    const count = () => h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_sessions').get();
    const before = count();
    h.failNextBatchAt(3);
    expect((await request('bid-session', body, 'reviewed-mock')).status).toBe(409);
    expect(count()).toEqual(before);
    const first = await request('bid-session', body, 'reviewed-mock');
    expect(first.status).toBe(201);
    const saved = await first.json();
    const after = count();
    h.sqlite.exec(
      "INSERT INTO credentials (name,fy_points_default) VALUES ('Synthetic source change',0)",
    );
    expect(await (await request('bid-session', body, 'reviewed-mock')).json()).toEqual({
      ...(saved as object),
      replayed: true,
    });
    expect(count()).toEqual(after);
    expect((await request('bid-session', body, 'stale-new-mock')).status).toBe(409);
    expect((await request('bid-session', { ...body, mode: 'live' }, 'reviewed-mock')).status).toBe(
      409,
    );
    expect(
      h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_sessions WHERE is_mock=0').get(),
    ).toEqual({ n: 0 });
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  it('blocks readiness when a seat lacks an explicit reviewed annual participation decision', async () => {
    h.sqlite
      .prepare('DELETE FROM rule_book_position_participation WHERE rule_book_version=?')
      .run(book);
    const review = await (await request('annual-plan/2027/review')).json();
    expect(review).toMatchObject({
      ready: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'inherited_participation_unreviewed' }),
      ]),
    });
  });

  it('retains an immutable reviewed source for later comparison without publishing or granting freeze approval', async () => {
    const { plan } = (await (await request('annual-plan/2027')).json()) as {
      plan: { ruleBookRevision: number; configurationRevision: number; sourceRevision: number };
    };
    const body = {
      expected_rule_revision: plan.ruleBookRevision,
      expected_configuration_revision: plan.configurationRevision,
      expected_source_revision: plan.sourceRevision,
      reason: 'Synthetic reviewed source checkpoint',
      accept_review: true,
    };
    h.failNextBatchAt(3);
    expect((await request('annual-plan/2027/review', body, 'source-review')).status).toBe(409);
    expect(
      h.sqlite.prepare('SELECT COUNT(*) AS n FROM annual_source_review_checkpoints').get(),
    ).toEqual({ n: 0 });
    const saved = await request('annual-plan/2027/review', body, 'source-review');
    expect(saved.status).toBe(200);
    const response = await saved.json();
    const initial = await (await request('annual-plan/2027/review?baseline=last_review')).json();
    expect(initial).toMatchObject({
      comparisonSource: 'last_review',
      impact: { available: true, changed: [], evidence: { changed: [] } },
      checkpoint: { sourceRevision: plan.sourceRevision },
    });
    expect(
      h.sqlite
        .prepare(
          "UPDATE members SET first_name='Synthetic renamed source' WHERE id=(SELECT MIN(id) FROM members)",
        )
        .run().changes,
    ).toBe(1);
    expect(await (await request('annual-plan/2027/review', body, 'source-review')).json()).toEqual({
      ...(response as object),
      replayed: true,
    });
    expect((await request('annual-plan/2027/review', body, 'stale-source-review')).status).toBe(
      409,
    );
    expect(() =>
      h.sqlite.exec("UPDATE annual_source_review_checkpoints SET reason='rewrite'"),
    ).toThrow('immutable');
    expect(
      h.sqlite
        .prepare('SELECT reviewed_source_revision FROM annual_plan_reviews WHERE bid_year=2027')
        .get(),
    ).toEqual({ reviewed_source_revision: null });
    expect(h.sqlite.prepare('SELECT status FROM rule_books WHERE version=?').get(book)).toEqual({
      status: 'draft',
    });
    expect(
      h.sqlite.prepare('SELECT COUNT(*) AS n FROM annual_source_review_checkpoints').get(),
    ).toEqual({ n: 1 });
  });

  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    token = await signJwt(
      {
        sub: 9001,
        emp: 'synthetic-admin',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Admin',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
    const start = await request(
      'annual-plan',
      {
        year: 2027,
        effective_on: '2027-01-01',
        credential_evaluation_on: '2026-12-01',
        expected_duration_days: 2,
        turn_timer_seconds: 180,
        reason: 'Synthetic annual freeze fixture',
      },
      'start',
    );
    expect(start.status).toBe(201);
    const created = (await start.json()) as { ruleBookVersion: string; templateVersion: string };
    book = created.ruleBookVersion;
    h.sqlite
      .prepare(
        "INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name) VALUES ('A-1',?,'A','1','Combat','Engine','FF','Firefighter')",
      )
      .run(created.templateVersion);
    h.sqlite
      .prepare(
        `INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain) VALUES (?,'A-1',?,'{"rank":["FF"],"credentials":[],"custom":[]}','{"max":0,"items":[]}','["rsc_seniority"]')`,
      )
      .run(book, created.templateVersion);
    await seedAuthoritativeBaseline(h, {
      bidYear: 2027,
      importId: 'synthetic-freeze',
      rows: [{ sourceRowNumber: 1, normalizedTopology: '{}' }],
    });
    h.sqlite
      .prepare(
        "INSERT INTO position_staffing_bindings (position_id,template_version,staffing_position_id,authoritative_source_ref,review_status,created_at) VALUES ('A-1',?,'synthetic-freeze-slot-1','synthetic binding source','approved',1)",
      )
      .run(created.templateVersion);
    h.sqlite
      .prepare(
        "INSERT INTO rule_book_position_participation (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at) VALUES (?,'A-1',?,'BIDDABLE','synthetic reviewed annual participation',1)",
      )
      .run(book, created.templateVersion);
    const execution = {
      v: 1,
      policyRevision: 'synthetic-freeze-policy',
      stages: [
        {
          id: 'annual',
          label: 'Annual',
          order: 0,
          memberIds: [10001],
          opportunityPositionIds: ['A-1'],
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
        actorMemberIds: [9001],
      })),
      specialtyCatalogReference: null,
      aDayPolicyReference: null,
      transitionPolicyReference: null,
      publicationPolicyReference: null,
    };
    const policy = await request('annual-policy-documents/2027', {
      rule_book_version: book,
      policy_text: 'Synthetic annual policy for local transaction tests only.',
      execution_policy: execution,
      reason: 'Synthetic policy preparation',
    });
    expect(policy.status, JSON.stringify(await policy.clone().json())).toBe(201);
    documentId = ((await policy.json()) as { id: string }).id;
    const mock = await request('bid-session', { bid_year: 2027, mode: 'mock' });
    expect(mock.status, JSON.stringify(await mock.clone().json())).toBe(201);
    mockId = ((await mock.json()) as { id: string }).id;
    const template = syntheticAnnualCompletionSource().state;
    if (!template.aDay) throw new Error('Synthetic A-Day fixture is required');
    const state: BidSessionState = {
      ...template,
      bidSessionId: mockId,
      lastSeq: 12,
      fills: { 'A-1': { memberId: 10001, ordinal: 1, bidId: 'synthetic-award' } },
      aDay: {
        ...template.aDay,
        picks: [
          {
            memberId: 10001,
            shift: 'A',
            aDay: 'G1',
            pickedAtMs: 1_799_999_999_000,
            forced: false,
            adminActorId: null,
          },
        ],
        bidOrder: [10001],
        cursor: 1,
        phase1: [[10001, { positionId: 'A-1', shift: 'A' }]],
      },
    };
    // Persisted fixtures exercise receipt/projection guards, not a production rehearsal claim.
    h.sqlite.prepare("UPDATE bid_sessions SET current_phase='complete' WHERE id=?").run(mockId);
    h.sqlite
      .prepare(
        'INSERT INTO canonical_bid_session_state (bid_session_id,current_seq,state_json,last_command_id,created_at,updated_at) VALUES (?,12,?,?,1,1)',
      )
      .run(mockId, JSON.stringify(state), 'synthetic-complete');
    h.sqlite
      .prepare(
        `INSERT INTO bid_command_receipts (command_id,bid_session_id,command_type,request_sha256,actor_id,expected_seq,result_seq,outcome,result_json,created_at) VALUES ('synthetic-complete',?,'live.complete_session',?,9001,11,12,'accepted','{}',1)`,
      )
      .run(mockId, 'a'.repeat(64));
  });
  afterEach(async () => teardownTestD1(h));
  async function body() {
    const data = (await (await request('annual-plan/2027')).json()) as {
      plan: { sourceRevision: number; ruleBookRevision: number; configurationRevision: number };
    };
    return {
      expected_rule_revision: data.plan.ruleBookRevision,
      expected_configuration_revision: data.plan.configurationRevision,
      expected_source_revision: data.plan.sourceRevision,
      mock_session_id: mockId,
      reason: 'Synthetic reviewed completion and findings',
      accept_review: true,
    };
  }
  it('freezes both designated artifacts and exactly replays after publication', async () => {
    const frozen = h.sqlite
      .prepare('SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id=?')
      .get(mockId) as { snapshot_json: string };
    expect(JSON.parse(frozen.snapshot_json).staffingBaseline).toMatchObject({
      baselineAcceptanceId: 'synthetic-freeze-acceptance',
      importId: 'synthetic-freeze',
    });
    const review = await request('annual-plan/2027/review');
    expect(await review.json()).toMatchObject({ ready: true });
    const payload = await body();
    const first = await request('annual-plan/2027/freeze', payload, 'freeze');
    expect(first.status, JSON.stringify(await first.clone().json())).toBe(200);
    const result = await first.json();
    expect(result).toMatchObject({ lifecycle: 'FROZEN', annualPolicyDocumentId: documentId });
    expect(h.sqlite.prepare('SELECT status FROM rule_books WHERE version=?').get(book)).toEqual({
      status: 'active',
    });
    expect(
      h.sqlite.prepare('SELECT status FROM annual_bid_policy_documents WHERE id=?').get(documentId),
    ).toEqual({ status: 'PUBLISHED' });
    expect(await (await request('annual-plan/2027/freeze', payload, 'freeze')).json()).toEqual({
      ...(result as object),
      replayed: true,
    });
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  it.each(['missing', 'different'])(
    'rejects a Mock with %s staffing provenance even when all other rehearsal material matches',
    async (variant) => {
      // Inject only the historical read result; never rewrite an immutable snapshot.
      const original = h.sqlite
        .prepare('SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id=?')
        .get(mockId) as { snapshot_json: string };
      const historical = JSON.parse(original.snapshot_json);
      if (variant === 'missing') historical.staffingBaseline = undefined;
      else historical.staffingBaseline.baselineAcceptanceId = 'synthetic-previous-baseline';
      const database = {
        ...h.env.DB,
        prepare(sql: string) {
          const statement = h.env.DB.prepare(sql);
          if (sql.includes('SELECT s.is_mock,s.bid_year,p.snapshot_json')) {
            const first = statement.first.bind(statement);
            statement.first = (async () => {
              const row = await first<Record<string, unknown>>();
              return row ? { ...row, snapshot_json: JSON.stringify(historical) } : null;
            }) as D1PreparedStatement['first'];
          }
          return statement;
        },
      } as D1Database;
      const result = await freezeAnnualPlan(database, {
        year: 2027,
        key: 'staffing-provenance',
        actorSubject: '9001',
        actorId: 9001,
        body: { ...(await body()), accept_review: true },
      });
      expect(result).toMatchObject({ ok: false, error: 'mock_configuration_or_evidence_changed' });
      expect(h.sqlite.prepare('SELECT status FROM rule_books WHERE version=?').get(book)).toEqual({
        status: 'draft',
      });
      expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM annual_freeze_reviews').get()).toEqual({
        n: 0,
      });
      expect(
        h.sqlite
          .prepare('SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id=?')
          .get(mockId),
      ).toEqual(original);
    },
  );
  it.each([2, 4, 6, 9])(
    'rolls back both artifacts and receipt when batch step %i fails',
    async (index) => {
      const payload = await body();
      h.failNextBatchAt(index);
      expect((await request('annual-plan/2027/freeze', payload, 'freeze')).status).toBe(409);
      expect(h.sqlite.prepare('SELECT status FROM rule_books WHERE version=?').get(book)).toEqual({
        status: 'draft',
      });
      expect(
        h.sqlite
          .prepare('SELECT status FROM annual_bid_policy_documents WHERE id=?')
          .get(documentId),
      ).toEqual({ status: 'DRAFT' });
      expect(
        h.sqlite
          .prepare("SELECT COUNT(*) AS n FROM annual_plan_receipts WHERE idempotency_key='freeze'")
          .get(),
      ).toEqual({ n: 0 });
      expect((await request('annual-plan/2027/freeze', payload, 'freeze')).status).toBe(200);
    },
  );
  it('rejects stale source evidence and mismatched Mock configuration', async () => {
    const payload = await body();
    h.sqlite.prepare("UPDATE members SET first_name='Changed' WHERE id=10001").run();
    expect(await (await request('annual-plan/2027/freeze', payload, 'stale')).json()).toMatchObject(
      { error: 'annual_plan_or_source_changed' },
    );
    h.sqlite
      .prepare(
        'UPDATE position_rules SET tie_break_chain=\'["points","rsc_seniority"]\' WHERE rule_book_version=?',
      )
      .run(book);
    expect(
      await (await request('annual-plan/2027/freeze', await body(), 'mismatch')).json(),
    ).toMatchObject({ error: 'mock_configuration_or_evidence_changed' });
    expect(h.sqlite.prepare('SELECT status FROM rule_books WHERE version=?').get(book)).toEqual({
      status: 'draft',
    });
  });
  it.each([
    'unknown award member',
    'unknown award position',
    'duplicate member award',
    'missing A-Day',
    'duplicate A-Day',
    'wrong A-Day shift',
    'sequence mismatch',
  ])('rejects completion material with %s', async (defect) => {
    const row = h.sqlite
      .prepare('SELECT state_json FROM canonical_bid_session_state WHERE bid_session_id=?')
      .get(mockId) as { state_json: string };
    const state = JSON.parse(row.state_json) as BidSessionState;
    const fill = state.fills['A-1'];
    const pick = state.aDay?.picks[0];
    if (!fill || !pick || !state.aDay) throw new Error('Incomplete synthetic fixture');
    switch (defect) {
      case 'unknown award member':
        fill.memberId = 987654;
        break;
      case 'unknown award position':
        state.fills = { unknown: fill };
        break;
      case 'duplicate member award':
        state.fills['duplicate-seat'] = { ...fill };
        break;
      case 'missing A-Day':
        state.aDay.picks = [];
        break;
      case 'duplicate A-Day':
        state.aDay.picks = [...state.aDay.picks, { ...pick }];
        break;
      case 'wrong A-Day shift':
        pick.shift = 'B';
        break;
      case 'sequence mismatch':
        state.lastSeq = 11;
        break;
    }
    const frozen = h.sqlite
      .prepare('SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id=?')
      .get(mockId) as { snapshot_json: string };
    const snapshot = BidSessionPolicySnapshotSchema.parse(JSON.parse(frozen.snapshot_json));
    if (snapshot.v !== 3) throw new Error('Synthetic V3 fixture required');
    if (defect === 'duplicate member award') {
      const original = snapshot.ruleBookMaterial.positions.find((p) => p.id === 'A-1');
      if (!original) throw new Error('Synthetic seat required');
      snapshot.ruleBookMaterial.positions.push({ ...original, id: 'duplicate-seat' });
    }
    expect(validRehearsalCompletion(state, snapshot, 12)).toBe(false);
    expect(h.sqlite.prepare('SELECT status FROM rule_books WHERE version=?').get(book)).toEqual({
      status: 'draft',
    });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM annual_freeze_reviews').get()).toEqual({
      n: 0,
    });
  });
});
