import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { loadTenureAsOf } from '../../src/lib/tenure-evidence.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const identitySql = `INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at) VALUES (100,'synthetic-100','Synthetic','Member','FF','FF',1,0,1,1);
INSERT INTO staffing_positions (id,stable_slot_key,division,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at) VALUES ('synthetic-seat','SYNTHETIC/TERM','Days','D','Training','Training','Instructor','FF','2026-01-01','approved',1,1);`;
const body = {
  staffing_position_id: 'synthetic-seat',
  expected_revision: 0,
  effective_on: '2026-09-01',
  status: 'UNPROTECTED',
  member_id: null,
  protected_from: null,
  protected_through: null,
  source_ref: 'synthetic:reviewed-service-and-cycle-facts',
  reason: 'Synthetic factual term review',
  term_member_id: 100,
  accumulated_service_months: 24,
  consecutive_bid_cycles: 1,
};

describe('assignment term evidence API', () => {
  let h: TestD1;
  let token: string;
  const post = (value: unknown, key: string) =>
    app.fetch(
      new Request('http://x/api/admin/tenure-evidence', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(value),
      }),
      h.env,
    );
  const get = (path: string) =>
    app.fetch(
      new Request(`http://x/api/admin/tenure-evidence${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      h.env,
    );
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(identitySql);
    token = await signJwt(
      {
        sub: 100,
        emp: 'synthetic-100',
        role: 'admin',
        rank: 'FF',
        first_name: 'Synthetic',
        last_name: 'Member',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
  });
  afterEach(async () => teardownTestD1(h));

  it.each([
    [100, 24.5, 1],
    [100, -1, 1],
    [100, 1201, 1],
    [100, 24, 1.5],
    [100, 24, -1],
    [100, 24, 101],
    [100, 'unknown', 1],
    [100, 24, 'unknown'],
    [null, 24, 1],
    [100, null, 1],
    [100, 24, null],
    [0, 24, 1],
    [-1, 24, 1],
    [100.5, 24, 1],
  ])(
    'migration rejects direct invalid facts holder=%s months=%s cycles=%s',
    (holder, months, cycles) => {
      const before = h.sqlite.serialize();
      expect(() =>
        h.sqlite
          .prepare(
            "INSERT INTO staffing_tenure_evidence (id,staffing_position_id,revision,effective_on,status,member_id,protected_from,protected_through,source_ref,actor_subject,reason,idempotency_key,request_json,created_at,term_member_id,accumulated_service_months,consecutive_bid_cycles) VALUES ('synthetic-direct','synthetic-seat',1,'2026-09-01','UNPROTECTED',NULL,NULL,NULL,'synthetic:direct-source','100','Synthetic direct input','synthetic-direct-key','{}',1,?,?,?)",
          )
          .run(holder, months, cycles),
      ).toThrow();
      const after = h.sqlite.serialize();
      expect(
        after.length === before.length && after.every((byte, index) => byte === before[index]),
      ).toBe(true);
    },
  );

  it.each([
    [0, 0],
    [1200, 100],
  ])('migration accepts exact numeric boundaries months=%s cycles=%s', (months, cycles) => {
    h.sqlite
      .prepare(
        "INSERT INTO staffing_tenure_evidence (id,staffing_position_id,revision,effective_on,status,member_id,protected_from,protected_through,source_ref,actor_subject,reason,idempotency_key,request_json,created_at,term_member_id,accumulated_service_months,consecutive_bid_cycles) VALUES ('synthetic-boundary','synthetic-seat',1,'2026-09-01','UNPROTECTED',NULL,NULL,NULL,'synthetic:boundary-source','100','Synthetic exact boundary','synthetic-boundary-key','{}',1,100,?,?)",
      )
      .run(months, cycles);
    expect(
      h.sqlite
        .prepare(
          'SELECT term_member_id,accumulated_service_months,consecutive_bid_cycles FROM staffing_tenure_evidence',
        )
        .get(),
    ).toEqual({
      term_member_id: 100,
      accumulated_service_months: months,
      consecutive_bid_cycles: cycles,
    });
  });

  it('preserves separate months and cycles, source attribution, null dates and idempotent audit', async () => {
    const first = await post(body, 'synthetic-term-one');
    expect(first.status).toBe(201);
    const saved = await first.json();
    const before = h.sqlite.serialize();
    expect(await (await post(body, 'synthetic-term-one')).json()).toEqual({
      ...(saved as object),
      replayed: true,
    });
    expect(
      h.sqlite.serialize().length === before.length &&
        h.sqlite.serialize().every((byte, index) => byte === before[index]),
    ).toBe(true);
    const expected = {
      termMemberId: 100,
      accumulatedServiceMonths: 24,
      consecutiveBidCycles: 1,
      memberId: null,
      protectedFrom: null,
      protectedThrough: null,
      sourceRef: body.source_ref,
      actorSubject: '100',
    };
    expect(await (await get('?as_of=2026-09-01')).json()).toMatchObject({ records: [expected] });
    expect(await (await get('/history/synthetic-seat')).json()).toMatchObject({
      records: [expected],
    });
    expect(await loadTenureAsOf(h.env.DB, '2026-08-31')).toEqual([]);
    expect(
      h.sqlite
        .prepare(
          "SELECT count(*) AS count FROM audit_log WHERE target_kind='staffing_tenure_evidence'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect((await post({ ...body, consecutive_bid_cycles: 2 }, 'synthetic-term-one')).status).toBe(
      409,
    );
  });

  it('appends dated cycle revisions without rewriting accumulated service or old source facts', async () => {
    expect((await post(body, 'synthetic-one')).status).toBe(201);
    expect(
      (
        await post(
          { ...body, expected_revision: 1, effective_on: '2027-09-01', consecutive_bid_cycles: 2 },
          'synthetic-two',
        )
      ).status,
    ).toBe(201);
    expect(await loadTenureAsOf(h.env.DB, '2027-08-31')).toMatchObject([
      { revision: 1, accumulatedServiceMonths: 24, consecutiveBidCycles: 1 },
    ]);
    expect(await loadTenureAsOf(h.env.DB, '2027-09-01')).toMatchObject([
      { revision: 2, accumulatedServiceMonths: 24, consecutiveBidCycles: 2 },
    ]);
    expect(() =>
      h.sqlite.exec('UPDATE staffing_tenure_evidence SET consecutive_bid_cycles=10'),
    ).toThrow(/immutable/);
    expect(() => h.sqlite.exec('DELETE FROM staffing_tenure_evidence')).toThrow(/immutable/);
  });

  it.each([
    { term_member_id: null },
    { accumulated_service_months: null },
    { consecutive_bid_cycles: null },
    { accumulated_service_months: -1 },
    { accumulated_service_months: 24.5 },
    { accumulated_service_months: 1201 },
    { consecutive_bid_cycles: -1 },
    { consecutive_bid_cycles: 1.5 },
    { consecutive_bid_cycles: 101 },
    {
      status: 'PROTECTED',
      member_id: 101,
      protected_from: '2026-01-01',
      protected_through: '2027-12-31',
    },
  ])('rejects inconsistent or out-of-range term facts without mutation %j', async (change) => {
    const before = h.sqlite.serialize();
    expect((await post({ ...body, ...change }, 'synthetic-invalid')).status).toBe(400);
    expect(
      h.sqlite.serialize().length === before.length &&
        h.sqlite.serialize().every((byte, index) => byte === before[index]),
    ).toBe(true);
  });

  it('requires a real term holder and rolls back evidence when its audit cannot commit', async () => {
    expect((await post({ ...body, term_member_id: 999 }, 'synthetic-missing-holder')).status).toBe(
      409,
    );
    h.failNextBatchAt(1);
    expect((await post(body, 'synthetic-audit-failure')).status).toBe(409);
    expect(await loadTenureAsOf(h.env.DB, '2026-09-01')).toEqual([]);
    expect(
      h.sqlite
        .prepare(
          "SELECT count(*) AS count FROM audit_log WHERE target_kind='staffing_tenure_evidence'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect((await post(body, 'synthetic-audit-failure')).status).toBe(201);
  });
});

it('migration 0063 preserves every old evidence value and adds null term facts without deriving dates', () => {
  const db = new Database(':memory:');
  const dir = new URL('../../migrations/', import.meta.url);
  try {
    for (const file of readdirSync(fileURLToPath(dir))
      .filter((name) => name.endsWith('.sql') && name < '0063_')
      .sort())
      db.exec(readFileSync(new URL(file, dir), 'utf8'));
    db.exec(identitySql);
    db.prepare(
      "INSERT INTO staffing_tenure_evidence (id,staffing_position_id,revision,effective_on,status,member_id,protected_from,protected_through,source_ref,actor_subject,reason,idempotency_key,request_json,created_at) VALUES ('synthetic-legacy','synthetic-seat',1,'2026-09-01','PROTECTED',100,'2026-09-01','2028-08-31','synthetic:legacy-source','100','Synthetic original evidence','synthetic-legacy-key','{}',1)",
    ).run();
    const before = db.prepare('SELECT * FROM staffing_tenure_evidence').get() as Record<
      string,
      unknown
    >;
    const sourceRevision = db
      .prepare('SELECT revision FROM annual_source_revision WHERE id=1')
      .get();
    db.exec(readFileSync(new URL('0063_assignment_term_evidence.sql', dir), 'utf8'));
    expect(db.prepare('SELECT * FROM staffing_tenure_evidence').get()).toEqual({
      ...before,
      term_member_id: null,
      accumulated_service_months: null,
      consecutive_bid_cycles: null,
    });
    expect(db.prepare('SELECT revision FROM annual_source_revision WHERE id=1').get()).toEqual(
      sourceRevision,
    );
    expect(() =>
      db.exec(
        'UPDATE staffing_tenure_evidence SET term_member_id=100,accumulated_service_months=24,consecutive_bid_cycles=2',
      ),
    ).toThrow(/immutable/);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {
    db.close();
  }
});
