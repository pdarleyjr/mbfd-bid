import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';
const KEY = 'd'.repeat(64);
describe('private drafts and source decisions', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });
  async function request(
    path: string,
    body?: unknown,
    sub = 0,
    role: 'admin' | 'member' = 'admin',
  ) {
    const token = await signJwt(
      {
        sub,
        emp: `synthetic-${sub}`,
        role,
        rank: 'CHIEF',
        first_name: 'Test',
        last_name: 'Admin',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      KEY,
    );
    return app.fetch(
      new Request(`http://x/api/admin/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
  }
  it('isolates private incomplete work by actor and rejects stale saves without altering annual rules', async () => {
    expect(
      (
        await request('working-drafts/annual-policy:2027', {
          expected_revision: 0,
          content: { unfinished: 'no adopted policy' },
        })
      ).status,
    ).toBe(200);
    expect(await (await request('working-drafts/annual-policy:2027')).json()).toMatchObject({
      revision: 1,
      content: { unfinished: 'no adopted policy' },
    });
    expect(
      await (await request('working-drafts/annual-policy:2027', undefined, 1)).json(),
    ).toMatchObject({ revision: 0, content: null });
    expect(
      (
        await request('working-drafts/annual-policy:2027', {
          expected_revision: 0,
          content: { wrong: 'stale' },
        })
      ).status,
    ).toBe(409);
    expect(
      (await request('working-drafts/annual-policy:2027', { expected_revision: 1, content: null }))
        .status,
    ).toBe(200);
    expect(
      await h.env.DB.prepare('SELECT COUNT(*) AS n FROM annual_bid_policy_documents').first(),
    ).toEqual({ n: 0 });
  });
  it('preserves successive decisions, rejects stale revisions and never modifies policy language', async () => {
    const body = {
      issue_id: 'synthetic-rule',
      expected_revision: 0,
      title: 'Review a rule',
      question: 'Which approved requirement applies?',
      area: 'rules',
      status: 'OPEN',
      decision: 'Awaiting approved evidence',
      source_ref: 'Synthetic source document',
      effective_on: '2027-01-01',
    };
    expect((await request('source-decisions/2027', body)).status).toBe(200);
    expect((await request('source-decisions/2027', body)).status).toBe(409);
    expect(
      (
        await request('source-decisions/2027', {
          ...body,
          expected_revision: 1,
          status: 'RESOLVED',
          decision: 'The synthetic authority confirms this rule',
        })
      ).status,
    ).toBe(200);
    const result = (await (await request('source-decisions/2027')).json()) as {
      history: { revision: number; status: string }[];
    };
    expect(result.history.map((r) => [r.revision, r.status])).toEqual([
      [2, 'RESOLVED'],
      [1, 'OPEN'],
    ]);
    expect(
      await h.env.DB.prepare('SELECT COUNT(*) AS n FROM annual_bid_policy_documents').first(),
    ).toEqual({ n: 0 });
  });
  it('rejects unauthenticated reads and invalid dates', async () => {
    expect(
      (
        await app.fetch(new Request('http://x/api/admin/source-decisions/2027'), {
          ...h.env,
          JWT_SIGNING_KEY: KEY,
        })
      ).status,
    ).toBe(401);
    expect(
      (await request('working-drafts/anything', { expected_revision: 0, content: {} })).status,
    ).toBe(400);
  });
});
