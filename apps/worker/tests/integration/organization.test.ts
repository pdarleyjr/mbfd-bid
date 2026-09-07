import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('dated organization catalog', () => {
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
  const request = (path: string, method = 'GET', body?: unknown, key = 'synthetic-create') =>
    app.fetch(
      new Request(`http://x/api/admin/organization${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      h.env,
    );
  const initial = {
    kind: 'STATION',
    display_name: 'Station 7',
    parent_id: null,
    effective_on: '2027-01-01',
    status: 'active',
    expected_revision: 0,
    evidence_ref: 'synthetic-approved-organization',
    reason: 'Synthetic catalog test',
  };

  it('creates an empty station and retains dated names under one identity', async () => {
    const created = await request('', 'POST', initial);
    expect(created.status).toBe(201);
    const body = (await created.json()) as { unit: { id: string; revision: number } };
    expect(h.sqlite.prepare('SELECT COUNT(*) AS count FROM staffing_positions').get()).toEqual({
      count: 0,
    });
    expect(await (await request('', 'POST', initial)).json()).toMatchObject({
      ...body,
      replayed: true,
    });
    const { kind: _kind, ...edit } = initial;
    expect(
      (
        await request(
          `/${body.unit.id}`,
          'PATCH',
          {
            ...edit,
            display_name: 'Station Seven',
            effective_on: '2028-01-01',
            expected_revision: 1,
          },
          'rename',
        )
      ).status,
    ).toBe(200);
    expect(await (await request('?as_of=2027-06-01')).json()).toMatchObject({
      units: [{ id: body.unit.id, name: 'Station 7', revision: 1, latestRevision: 2 }],
    });
    expect(await (await request('?as_of=2028-01-01')).json()).toMatchObject({
      units: [{ id: body.unit.id, name: 'Station Seven', revision: 2 }],
    });
    expect(
      (await request(`/${body.unit.id}`, 'PATCH', { ...edit, expected_revision: 1 }, 'stale'))
        .status,
    ).toBe(409);
    expect(() =>
      h.sqlite
        .prepare('UPDATE organization_units SET id=? WHERE id=?')
        .run('changed', body.unit.id),
    ).toThrow('identity is immutable');
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('rejects missing and circular parents and blocks retirement while an apparatus depends on a station', async () => {
    const created = (await (await request('', 'POST', initial)).json()) as { unit: { id: string } };
    expect(
      (
        await request(
          '',
          'POST',
          { ...initial, kind: 'APPARATUS', display_name: 'Engine 7', parent_id: 'missing' },
          'missing-parent',
        )
      ).status,
    ).toBe(409);
    const apparatus = await request(
      '',
      'POST',
      { ...initial, kind: 'APPARATUS', display_name: 'Engine 7', parent_id: created.unit.id },
      'apparatus',
    );
    expect(apparatus.status).toBe(201);
    const { kind: _kind, ...edit } = initial;
    expect(
      (
        await request(
          `/${created.unit.id}`,
          'PATCH',
          { ...edit, parent_id: created.unit.id, expected_revision: 1 },
          'cycle',
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          `/${created.unit.id}`,
          'PATCH',
          { ...edit, status: 'retired', expected_revision: 1, effective_on: '2028-01-01' },
          'retire',
        )
      ).status,
    ).toBe(409);
    expect(
      await (await request(`/${created.unit.id}/dependencies?as_of=2028-01-01`)).json(),
    ).toMatchObject({ retirementBlocked: true, children: [{ name: 'Engine 7' }] });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS count FROM organization_units').get()).toEqual({
      count: 2,
    });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 2 });
  });

  it('keeps one winning concurrent edit and rolls back a failed receipt', async () => {
    const created = (await (await request('', 'POST', initial)).json()) as { unit: { id: string } };
    const { kind: _kind, ...edit } = initial;
    const results = await Promise.all([
      request(
        `/${created.unit.id}`,
        'PATCH',
        { ...edit, expected_revision: 1, display_name: 'First reviewed name' },
        'first',
      ),
      request(
        `/${created.unit.id}`,
        'PATCH',
        { ...edit, expected_revision: 1, display_name: 'Second reviewed name' },
        'second',
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    h.failNextBatchAt(2);
    expect(
      (await request('', 'POST', { ...initial, display_name: 'Uncommitted' }, 'rollback')).status,
    ).toBe(409);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS count FROM organization_units').get()).toEqual({
      count: 1,
    });
    expect(
      h.sqlite.prepare('SELECT COUNT(*) AS count FROM organization_command_receipts').get(),
    ).toEqual({ count: 2 });
  });
});
