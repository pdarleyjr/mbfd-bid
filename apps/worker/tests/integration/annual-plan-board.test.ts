import { AdminBidBoardSchema } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('annual plan and independent board', () => {
  let h: TestD1;
  let token: string;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    token = await signJwt(
      {
        sub: 0,
        emp: 'synthetic-admin',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Admin',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
  });
  afterEach(async () => teardownTestD1(h));
  const request = (path: string, init: RequestInit = {}) =>
    app.fetch(
      new Request(`http://x/api/admin/${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      }),
      h.env,
    );
  const start = (key = 'start-2027', extra = {}) =>
    request('annual-plan', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({
        year: 2027,
        effective_on: '2027-01-01',
        credential_evaluation_on: '2026-12-01',
        expected_duration_days: 2,
        turn_timer_seconds: 180,
        reason: 'Synthetic reviewed start',
        ...extra,
      }),
    });

  it('creates one designated blank draft, resumes it, and replays the exact receipt', async () => {
    const first = await start();
    expect(first.status).toBe(201);
    const created = (await first.json()) as Record<string, unknown>;
    expect(created).toMatchObject({
      year: 2027,
      lifecycle: 'DRAFT',
      replayed: false,
      sourceSessionId: null,
    });
    const replay = await start();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ...created, replayed: true });
    expect((await start('other')).status).toBe(409);
    expect((await start('start-2027', { turn_timer_seconds: 120 })).status).toBe(409);
    const plan = await request('annual-plan/2027');
    expect(plan.status).toBe(200);
    expect(await plan.json()).toMatchObject({
      plan: { lifecycle: 'DRAFT', effectiveOn: '2027-01-01', configurationRevision: 1 },
      coverage: { valid: false },
    });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 1 });
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('adds explicitly reviewed organizational seats with revision and retry protection', async () => {
    expect((await start()).status).toBe(201);
    h.sqlite.exec(`INSERT INTO staffing_positions (id,stable_slot_key,division,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at)
      VALUES ('reviewed-seat','SYNTHETIC/REVIEWED','Combat','A','legacy-source-label','Engine','Firefighter','FF','2027-01-01','approved',1,1)`);
    const created = await request('organization', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'station7' },
      body: JSON.stringify({
        kind: 'STATION',
        display_name: 'Station 7',
        parent_id: null,
        effective_on: '2027-01-01',
        status: 'active',
        expected_revision: 0,
        evidence_ref: 'synthetic-reviewed-org',
        reason: 'Synthetic organization setup',
      }),
    });
    expect(created.status).toBe(201);
    const organization = (await created.json()) as { unit: { id: string } };
    expect(
      (
        await request('organization/seats/reviewed-seat/link', {
          method: 'POST',
          headers: { 'Idempotency-Key': 'seat-link' },
          body: JSON.stringify({
            organization_unit_id: organization.unit.id,
            effective_on: '2027-01-01',
            expected_revision: 0,
            evidence_ref: 'synthetic-reviewed-seat',
            reason: 'Synthetic reviewed association',
          }),
        })
      ).status,
    ).toBe(200);
    const selected = (await (await request('annual-plan/2027')).json()) as {
      plan: { sourceRevision: number; ruleBookRevision: number; configurationRevision: number };
    };
    const body = {
      expected_rule_revision: selected.plan.ruleBookRevision,
      expected_configuration_revision: selected.plan.configurationRevision,
      expected_source_revision: selected.plan.sourceRevision,
      seats: [
        {
          staffing_position_id: 'reviewed-seat',
          bid_participation: 'RESERVED_NON_BIDDABLE',
          is_floating: false,
          is_vacant_by_design: false,
          is_excluded_from_count: false,
        },
      ],
      evidence_ref: 'synthetic-annual-review',
      reason: 'Synthetic reviewed annual seat',
    };
    const add = () =>
      request('annual-plan/2027/seats', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'add-reviewed-seat' },
        body: JSON.stringify(body),
      });
    const first = await add();
    expect(first.status).toBe(201);
    const result = (await first.json()) as Record<string, unknown>;
    expect(await (await add()).json()).toEqual({ ...result, replayed: true });
    const upcoming = await (await request('bid-board?view=upcoming&year=2027&shift=A')).json();
    expect(upcoming).toMatchObject({
      seats: [{ station: 'Station 7', participation: 'RESERVED_NON_BIDDABLE', mapping: 'mapped' }],
    });
    expect(
      h.sqlite.prepare('SELECT station FROM staffing_positions WHERE id=?').get('reviewed-seat'),
    ).toEqual({ station: 'legacy-source-label' });
    expect(
      (
        await request(`organization/${organization.unit.id}`, {
          method: 'PATCH',
          headers: { 'Idempotency-Key': 'retire-linked-org' },
          body: JSON.stringify({
            display_name: 'Station 7',
            parent_id: null,
            effective_on: '2027-01-01',
            status: 'retired',
            expected_revision: 1,
            evidence_ref: 'synthetic-review',
            reason: 'Synthetic blocked retirement',
          }),
        })
      ).status,
    ).toBe(409);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('reviews inherited seats without changing their IDs, rolls back failures, and removes only the annual draft material', async () => {
    const created = (await (await start()).json()) as {
      templateVersion: string;
      ruleBookVersion: string;
    };
    const { templateVersion: template, ruleBookVersion: book } = created;
    h.sqlite.exec(`
      INSERT INTO staffing_positions (id,stable_slot_key,division,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at)
        VALUES ('reviewed-seat','SYNTHETIC/REVIEWED','Combat','A','raw station','Engine','Firefighter','FF','2027-01-01','approved',1,1);
      INSERT INTO organization_units VALUES ('synthetic-org','STATION',1);
      INSERT INTO organization_unit_versions VALUES ('synthetic-org',1,'Station 7',NULL,'2027-01-01','active','Synthetic organization source','0','Synthetic reviewed organization',1);
      INSERT INTO organization_staffing_links VALUES ('reviewed-seat',1,'synthetic-org','2027-01-01','Synthetic seat source','0','Synthetic reviewed binding',1);
      INSERT INTO position_templates (version,effective_year) VALUES ('synthetic-old',2026);
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name) VALUES ('A-inherited','synthetic-old','A','Station 1','Combat','Engine','FF','Firefighter');
    `);
    h.sqlite
      .prepare(
        'INSERT INTO positions SELECT id,?,shift,station,division,unit,rank_required,position_name,is_floating,is_vacant_by_design,is_excluded_from_count FROM positions WHERE template_version=?',
      )
      .run(template, 'synthetic-old');
    h.sqlite
      .prepare(
        "INSERT INTO rule_book_position_participation (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at) VALUES (?,'A-inherited',?,'RESERVED_NON_BIDDABLE','inherited-unreviewed:synthetic',1)",
      )
      .run(book, template);
    h.sqlite
      .prepare(
        `INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain) VALUES (?,'A-inherited',?,'{"rank":["FF"],"credentials":[],"custom":[]}','{"max":0,"items":[]}','["rsc_seniority"]')`,
      )
      .run(book, template);
    const before = h.sqlite
      .prepare('SELECT * FROM positions WHERE template_version=?')
      .all('synthetic-old');
    const expected = async () => {
      const { plan } = (await (await request('annual-plan/2027')).json()) as {
        plan: { ruleBookRevision: number; configurationRevision: number; sourceRevision: number };
      };
      return {
        expected_rule_revision: plan.ruleBookRevision,
        expected_configuration_revision: plan.configurationRevision,
        expected_source_revision: plan.sourceRevision,
      };
    };
    const post = (path: string, body: unknown, key: string) =>
      request(path, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      });
    const body = {
      ...(await expected()),
      seats: [
        {
          existing_position_id: 'A-inherited',
          staffing_position_id: 'reviewed-seat',
          bid_participation: 'BIDDABLE',
          is_floating: false,
          is_vacant_by_design: false,
          is_excluded_from_count: false,
        },
      ],
      evidence_ref: 'Synthetic annual participation source',
      reason: 'Synthetic annual seat review',
    };
    const ruleBefore = h.sqlite
      .prepare('SELECT * FROM position_rules WHERE rule_book_version=?')
      .all(book);
    h.failNextBatchAt(2);
    expect((await post('annual-plan/2027/seats', body, 'review-seat')).status).toBe(409);
    expect(
      h.sqlite
        .prepare('SELECT station FROM positions WHERE id=? AND template_version=?')
        .get('A-inherited', template),
    ).toEqual({ station: 'Station 1' });
    const first = await post('annual-plan/2027/seats', body, 'review-seat');
    expect(first.status).toBe(201);
    const saved = await first.json();
    expect(await (await post('annual-plan/2027/seats', body, 'review-seat')).json()).toEqual({
      ...(saved as object),
      replayed: true,
    });
    expect((await post('annual-plan/2027/seats', body, 'stale-review')).status).toBe(409);
    expect(
      h.sqlite.prepare('SELECT * FROM position_rules WHERE rule_book_version=?').all(book),
    ).toEqual(ruleBefore);
    expect(await (await request('annual-plan/2027/seats')).json()).toMatchObject({
      seats: [
        {
          id: 'A-inherited',
          station: 'Station 7',
          participation: 'BIDDABLE',
          participationSource: body.evidence_ref,
          bindingStatus: 'approved',
        },
      ],
    });
    const removal = {
      ...(await expected()),
      position_ids: ['A-inherited'],
      confirm_remove: true,
      evidence_ref: 'Synthetic approved removal',
      reason: 'Synthetic remove from draft',
    };
    h.failNextBatchAt(4);
    expect((await post('annual-plan/2027/seats/remove', removal, 'remove-seat')).status).toBe(409);
    expect(
      h.sqlite.prepare('SELECT * FROM position_rules WHERE rule_book_version=?').all(book),
    ).toEqual(ruleBefore);
    const removed = await post('annual-plan/2027/seats/remove', removal, 'remove-seat');
    expect(removed.status).toBe(200);
    const receipt = await removed.json();
    expect(
      await (await post('annual-plan/2027/seats/remove', removal, 'remove-seat')).json(),
    ).toEqual({ ...(receipt as object), replayed: true });
    expect(
      h.sqlite.prepare('SELECT * FROM positions WHERE template_version=?').all(template),
    ).toEqual([]);
    expect(
      h.sqlite.prepare('SELECT * FROM positions WHERE template_version=?').all('synthetic-old'),
    ).toEqual(before);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM staffing_positions').get()).toEqual({
      n: 1,
    });
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('previews and saves scoped rules atomically and preserves exact retry responses', async () => {
    const created = (await (await start()).json()) as {
      templateVersion: string;
      ruleBookVersion: string;
    };
    h.sqlite
      .prepare(
        `INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name) VALUES ('A-1',?,'A','7','Combat','Engine','FF','Firefighter')`,
      )
      .run(created.templateVersion);
    const current = (await (await request('annual-plan/2027')).json()) as {
      plan: { sourceRevision: number };
    };
    const body = {
      expected_rule_revision: 0,
      expected_configuration_revision: 1,
      expected_source_revision: current.plan.sourceRevision,
      preview: true,
      reason: 'Synthetic reviewed rules',
      profiles: [
        {
          id: 'department',
          name: 'Synthetic department',
          sourceRef: 'synthetic-only',
          scope: { kind: 'department' },
          requirements: { credentials: [], custom: [] },
          scoring: { v: 1, total: [], so: [], mo: [] },
          tieBreakChain: ['rsc_seniority'],
        },
      ],
    };
    const submit = (value: unknown, key = 'profile-save') =>
      request('annual-plan/2027/profiles', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(value),
      });
    const preview = await submit(body);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      ok: true,
      compiled: [{ rule: { positionId: 'A-1' }, provenance: { scoring: ['department'] } }],
    });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM position_rules').get()).toEqual({ n: 0 });
    h.failNextBatchAt(3);
    expect((await submit({ ...body, preview: false })).status).toBe(409);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM position_rules').get()).toEqual({ n: 0 });
    const saved = await submit({ ...body, preview: false });
    expect(saved.status).toBe(200);
    const response = await saved.json();
    expect(response).toMatchObject({ compiledCount: 1, ruleBookRevision: 1, revision: 1 });
    expect(await (await submit({ ...body, preview: false })).json()).toEqual({
      ...(response as object),
      replayed: true,
    });
    expect((await submit({ ...body, preview: false }, 'stale-other')).status).toBe(409);
    const nextSource = h.sqlite
      .prepare('SELECT revision FROM annual_source_revision WHERE id=1')
      .get() as { revision: number };
    const updated = await submit(
      {
        ...body,
        expected_rule_revision: 1,
        expected_source_revision: nextSource.revision,
        preview: false,
      },
      'updated',
    );
    expect(updated.status).toBe(200);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM position_rules').get()).toEqual({ n: 1 });
    expect(
      h.sqlite.prepare('SELECT COUNT(*) AS n FROM annual_rule_profile_revisions').get(),
    ).toEqual({ n: 2 });
    expect(
      (
        await submit(
          {
            ...body,
            expected_rule_revision: 2,
            expected_source_revision: (
              h.sqlite.prepare('SELECT revision FROM annual_source_revision WHERE id=1').get() as {
                revision: number;
              }
            ).revision,
            profiles: [
              {
                ...body.profiles[0],
                requirements: { credentials: ['Unreviewed token'], custom: [] },
              },
            ],
          },
          'unknown',
        )
      ).status,
    ).toBe(409);
  });

  it('reviews an incomplete plan without mutating it or inventing readiness', async () => {
    expect((await start()).status).toBe(201);
    const before = h.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get();
    const review = await request('annual-plan/2027/review');
    expect(review.status).toBe(200);
    expect(await review.json()).toMatchObject({
      ready: false,
      participants: null,
      impact: { available: false, evaluatedComparisons: 0, changed: [] },
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'rule_coverage' }),
        expect.objectContaining({ code: 'operating_policy_required' }),
      ]),
    });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual(before);
    expect(() =>
      h.sqlite
        .prepare(
          "UPDATE bid_years SET config_json=json_remove(config_json,'$.personnelEvaluationOn') WHERE year=2027",
        )
        .run(),
    ).toThrow(/personnel date/);
  });

  it.each([1, 4, 5])('rolls back the entire start when statement %i fails', async (index) => {
    h.failNextBatchAt(index);
    expect((await start()).status).toBe(409);
    for (const table of [
      'annual_plan_receipts',
      'position_templates',
      'rule_books',
      'bid_years',
      'annual_plan_reviews',
      'audit_log',
    ]) {
      expect(h.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({
        count: 0,
      });
    }
    expect((await start()).status).toBe(201);
  });

  it('requires authentication and rejects unsupported dates and missing official sources', async () => {
    expect((await app.fetch(new Request('http://x/api/admin/annual-plan'), h.env)).status).toBe(
      401,
    );
    expect((await app.fetch(new Request('http://x/api/admin/bid-board'), h.env)).status).toBe(401);
    expect((await start('bad-date', { effective_on: '2027-02-30' })).status).toBe(400);
    expect((await start('wrong-year', { effective_on: '2028-01-01' })).status).toBe(400);
    expect((await start('missing-source', { source_session_id: 'nonexistent' })).status).toBe(409);
    expect(await (await request('annual-plan/official-sources')).json()).toMatchObject({
      sources: [],
    });
    expect(await (await request('bid-board?view=previous')).json()).toMatchObject({
      view: 'previous',
      lifecycle: 'UNAVAILABLE',
      seats: [],
    });
  });

  it('keeps Upcoming seats free of occupants while Current uses dated assignments and overlays', async () => {
    const created = (await (await start()).json()) as {
      templateVersion: string;
      ruleBookVersion: string;
    };
    h.sqlite
      .prepare(`INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
      VALUES ('future',?,'A','7','Combat','Future Engine','FF','Future Firefighter')`)
      .run(created.templateVersion);
    h.sqlite.exec(`INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at)
      VALUES (1,'synthetic-1','Current','Occupant','FF','FF',1,0,1,1);
      INSERT INTO staffing_positions (id,stable_slot_key,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at)
      VALUES ('current','SYNTHETIC/CURRENT','A','1','Engine','Firefighter','FF','2026-01-01','approved',1,1),
        ('vacant','SYNTHETIC/VACANT','A','2','Engine','Firefighter','FF','2026-01-01','approved',1,1);
      INSERT INTO member_assignments (id,member_id,staffing_position_id,origin_type,origin_ref,status,effective_from,created_at,updated_at)
      VALUES ('assignment',1,'current','ADMIN_TRANSFER','synthetic-test','active','2026-06-01',1,1);
      INSERT INTO temporary_operational_overlays (id,member_id,kind,underlying_assignment_id,effective_on,planned_end_on,actual_end_on,status,provenance,actor_subject,idempotency_key,created_at)
      VALUES ('overlay',1,'SPECIAL_ASSIGNMENT','assignment','2026-07-01','2026-07-15','2026-08-01','ended','synthetic-test','0','overlay-key',1);`);
    const upcoming = AdminBidBoardSchema.parse(
      await (await request('bid-board?view=upcoming&year=2027&shift=A')).json(),
    );
    expect(upcoming).toMatchObject({
      view: 'upcoming',
      lifecycle: 'DRAFT',
      seats: [
        { id: 'future', station: '7', participation: 'BIDDABLE', mapping: 'review_required' },
      ],
    });
    expect(JSON.stringify(upcoming)).not.toMatch(/occupant|memberId|Current Occupant/);
    expect(
      AdminBidBoardSchema.safeParse({
        ...upcoming,
        seats: [{ ...upcoming.seats[0], occupant: null }],
      }).success,
    ).toBe(false);
    const current = AdminBidBoardSchema.parse(
      await (await request('bid-board?view=current&as_of=2026-07-20&shift=A')).json(),
    );
    expect(current).toMatchObject({
      view: 'current',
      seats: [
        {
          id: 'current',
          occupant: { memberId: 1, name: 'Current Occupant' },
          temporaryContext: [{ id: 'overlay' }],
        },
        { id: 'vacant', occupancy: 'vacant', occupant: null },
      ],
    });
    expect(
      await (await request('bid-board?view=current&as_of=2026-08-01&shift=A')).json(),
    ).toMatchObject({ seats: [{ id: 'current', temporaryContext: [] }, { id: 'vacant' }] });
    expect(
      await (await request('bid-board?view=current&as_of=2026-05-01&shift=A')).json(),
    ).toMatchObject({
      seats: [
        { id: 'current', occupant: null },
        { id: 'vacant', occupant: null },
      ],
    });
    expect((await request('bid-board?view=upcoming')).status).toBe(400);
    expect((await request('bid-board?view=constructor')).status).toBe(400);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});
