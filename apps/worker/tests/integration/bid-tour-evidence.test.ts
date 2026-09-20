import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';
describe('reviewed full Days Bid tour evidence', () => {
  let h: TestD1;
  let token: string;
  const body = {
    memberId: 100,
    expectedRevision: 0,
    effectiveOn: '2026-09-19',
    completedDaysTour: false,
    sourceRef: 'synthetic reviewed prior Days tours',
    reason: 'Synthetic history review',
  };
  const request = (value: unknown, key: string) =>
    app.fetch(
      new Request('http://x/api/admin/bid-tour-evidence', {
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
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys=ON');
    h.sqlite.exec(
      "INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at) VALUES (100,'synthetic-100','Synthetic','Member','FF','FF',1,0,1,1)",
    );
    token = await signJwt(
      {
        sub: 100,
        emp: 'synthetic-100',
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
  it('records explicit false, true and unknown as separate immutable revisions without changing personnel', async () => {
    const before = h.sqlite.prepare('SELECT * FROM members').all();
    const first = await request(body, 'first');
    expect(first.status).toBe(201);
    expect(await (await request(body, 'first')).json()).toMatchObject({
      replayed: true,
      revision: 1,
    });
    expect((await request({ ...body, completedDaysTour: true }, 'first')).status).toBe(409);
    expect(
      (await request({ ...body, expectedRevision: 1, completedDaysTour: true }, 'second')).status,
    ).toBe(201);
    expect(
      (await request({ ...body, expectedRevision: 2, completedDaysTour: null }, 'third')).status,
    ).toBe(201);
    expect(
      h.sqlite
        .prepare('SELECT completed_days_tour FROM member_bid_tour_evidence ORDER BY revision')
        .all(),
    ).toEqual([
      { completed_days_tour: 0 },
      { completed_days_tour: 1 },
      { completed_days_tour: null },
    ]);
    expect(h.sqlite.prepare('SELECT * FROM members').all()).toEqual(before);
    expect(() => h.sqlite.exec('DELETE FROM member_bid_tour_evidence')).toThrow('immutable');
  });
  it('rejects a missing identity, stale revision and impossible date without evidence writes', async () => {
    expect((await request({ ...body, memberId: 999 }, 'missing')).status).toBe(409);
    expect((await request({ ...body, expectedRevision: 1 }, 'stale')).status).toBe(409);
    expect((await request({ ...body, effectiveOn: '2026-02-30' }, 'date')).status).toBe(400);
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM member_bid_tour_evidence').get()).toEqual({
      n: 0,
    });
  });
});
