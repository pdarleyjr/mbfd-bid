import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { serviceCreditsAsOf } from '../../src/lib/service-evidence.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';
describe('reviewed cumulative service evidence', () => {
  let h: TestD1;
  let token: string;
  const request = (body: unknown, key: string) =>
    app.fetch(
      new Request('http://x/api/admin/service-evidence', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(body),
      }),
      h.env,
    );
  const base = {
    member_id: 100,
    service_code: 'RESCUE_DIVISION',
    expected_revision: 0,
    effective_on: '2026-08-01',
    verified_months: 36,
    source_ref: 'synthetic reviewed cumulative service record',
    reason: 'Synthetic service evidence test',
  };
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
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
  it('retains dated revisions, exact receipts, and explicit unknown evidence', async () => {
    const initial = await request(base, 'first');
    expect(initial.status).toBe(201);
    const initialResponse = await initial.json();
    expect(await (await request(base, 'first')).json()).toEqual({
      ...(initialResponse as object),
      replayed: true,
    });
    expect((await request({ ...base, verified_months: 40 }, 'first')).status).toBe(409);
    expect(
      (
        await request(
          { ...base, expected_revision: 1, effective_on: '2026-09-01', verified_months: null },
          'unknown',
        )
      ).status,
    ).toBe(201);
    expect((await request({ ...base, effective_on: '2026-09-02' }, 'stale')).status).toBe(409);
    const rows = (
      await h.env.DB.prepare(
        'SELECT id AS recordId,member_id AS memberId,service_code AS serviceCode,revision,effective_on AS effectiveOn,verified_months AS verifiedMonths,source_ref AS sourceRef,actor_subject AS actorSubject FROM member_service_evidence',
      ).all()
    ).results as Parameters<typeof serviceCreditsAsOf>[0];
    expect(serviceCreditsAsOf(rows, 100, '2026-07-31')).toEqual([]);
    expect(serviceCreditsAsOf(rows, 100, '2026-08-15')).toMatchObject([{ verifiedMonths: 36 }]);
    expect(serviceCreditsAsOf(rows, 100, '2026-09-15')).toMatchObject([{ verifiedMonths: null }]);
    expect(() =>
      h.sqlite.prepare('UPDATE member_service_evidence SET verified_months=60').run(),
    ).toThrow(/immutable/);
  });
  it('rolls back evidence when audit fails and rejects unknown member or service type', async () => {
    h.failNextBatchAt(1);
    expect((await request(base, 'retry')).status).toBe(409);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM member_service_evidence').get()).toEqual({
      n: 0,
    });
    expect((await request(base, 'retry')).status).toBe(201);
    expect((await request({ ...base, member_id: 999 }, 'missing-member')).status).toBe(409);
    expect((await request({ ...base, service_code: 'UNREGISTERED' }, 'missing-type')).status).toBe(
      409,
    );
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});
