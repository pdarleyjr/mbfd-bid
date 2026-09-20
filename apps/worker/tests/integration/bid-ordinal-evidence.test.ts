import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { projectBidOrdinals } from '../../src/lib/bid-ordinal-evidence.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('source-certified annual Bid ordinal evidence', () => {
  let h: TestD1;
  let token: string;
  const body = {
    bidYear: 2026,
    expectedRevision: 0,
    sourceSha256: 'a'.repeat(64),
    sourceRef: 'synthetic source-certified ordinal sheet',
    reason: 'Synthetic reviewed Bid ordering import',
    entries: [
      { memberId: 100, employeeId: 'synthetic-100', timeInGrade: 2, departmentService: 1 },
      { memberId: 101, employeeId: 'synthetic-101', timeInGrade: 1, departmentService: 2 },
    ],
  };
  const request = (value: unknown, key: string) =>
    app.fetch(
      new Request('http://x/api/admin/bid-ordinals', {
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
    h.sqlite.pragma('foreign_keys = ON');
    for (const id of [100, 101])
      h.sqlite
        .prepare(
          "INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at) VALUES (?,?,'Synthetic','Member','FF','FF',99,0,1,1)",
        )
        .run(id, `synthetic-${id}`);
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
  it('preserves personnel bytes, records source evidence and retries exactly', async () => {
    const before = h.sqlite.prepare('SELECT * FROM members ORDER BY id').all();
    const revision = h.sqlite
      .prepare('SELECT revision FROM annual_source_revision WHERE id=1')
      .get() as { revision: number };
    const first = await request(body, 'ordinal-first');
    expect(first.status).toBe(201);
    const result = await first.json();
    expect(await (await request(body, 'ordinal-first')).json()).toEqual({
      ...(result as object),
      replayed: true,
    });
    expect(
      (await request({ ...body, reason: 'Different reviewed reason' }, 'ordinal-first')).status,
    ).toBe(409);
    expect((await request(body, 'ordinal-stale')).status).toBe(409);
    expect(h.sqlite.prepare('SELECT * FROM members ORDER BY id').all()).toEqual(before);
    expect(
      h.sqlite.prepare('SELECT revision FROM annual_source_revision WHERE id=1').get(),
    ).toEqual({ revision: revision.revision + 1 });
    expect(() => h.sqlite.exec('DELETE FROM bid_ordinal_datasets')).toThrow('immutable');
  });
  it('rejects duplicate ordinals, invalid integers and mismatched stable identities without evidence or audit writes', async () => {
    const audit = h.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get();
    expect(
      (
        await request(
          { ...body, entries: body.entries.map((row) => ({ ...row, timeInGrade: 1 })) },
          'duplicate',
        )
      ).status,
    ).toBe(400);
    expect(
      (await request({ ...body, entries: [{ ...body.entries[0], timeInGrade: 1.5 }] }, 'fraction'))
        .status,
    ).toBe(400);
    expect(
      (
        await request(
          { ...body, entries: [{ ...body.entries[0], employeeId: 'wrong' }] },
          'mismatch',
        )
      ).status,
    ).toBe(409);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_ordinal_datasets').get()).toEqual({
      n: 0,
    });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual(audit);
  });
  it('freezes distinct ordinals and leaves a changed or missing identity without evidence', () => {
    const dataset = {
      id: 'synthetic-dataset',
      bidYear: 2026,
      sourceSha256: body.sourceSha256,
      sourceRef: body.sourceRef,
      entriesJson: JSON.stringify(body.entries),
    };
    const projected = projectBidOrdinals(dataset, [
      { id: 100, employeeId: 'synthetic-100' },
      { id: 101, employeeId: 'identity-changed' },
    ]);
    expect(projected.get(100)).toMatchObject({ timeInGrade: 2, departmentService: 1 });
    expect(projected.has(101)).toBe(false);
    expect(projectBidOrdinals(undefined, []).size).toBe(0);
  });
});
