import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index.js';
import { bidResultPackageCsv, loadBidResultPackage } from '../../src/lib/bid-result-package.js';
import { signJwt } from '../../src/lib/jwt.js';
import { seedSyntheticOfficialCompletion } from './helpers/synthetic-official-completion.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('manual final result distribution', () => {
  let h: TestD1;
  let token: string;
  const session = 'annual-real-2027';
  async function jwt(role: 'admin' | 'member' = 'admin', fresh = true, sub = 99) {
    return signJwt(
      {
        sub,
        emp: sub === 99 ? 'synthetic-reviewer' : `synthetic-${sub}`,
        role,
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Reviewer',
        ...(fresh ? { fresh_auth_at: Math.floor(Date.now() / 1000) } : {}),
      },
      h.env.JWT_SIGNING_KEY,
    );
  }
  function request(
    path = '',
    body?: unknown,
    key = 'synthetic-review',
    authorization: string | null = token,
    id = session,
  ) {
    return app.fetch(
      new Request(`http://x/api/admin/result-distribution/${id}${path}`, {
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
        headers: {
          ...(authorization === null ? {} : { Authorization: `Bearer ${authorization}` }),
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
      }),
      h.env,
    );
  }
  async function reviewBody() {
    const current = (await (await request()).json()) as { packageSha256: string };
    return {
      expectedCompletionSeq: 12,
      packageSha256: current.packageSha256,
      channel: 'EMAIL',
      expectedRevision: 0,
      status: 'COMPLETED',
      publishedOn: '2027-02-02',
      evidenceRef: 'Synthetic sent message record',
      reason: 'Reviewed exact synthetic package distribution',
    };
  }
  function count(table: string) {
    return h.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
  }
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-02-03T15:00:00Z'));
    h = await setupTestD1();
    // Explicit local identity for the authenticated synthetic administrator.
    await h.db.run(
      "INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,employment_status,created_at,updated_at) VALUES (900001,'synthetic-0','Synthetic','Unprivileged Admin','CHIEF','EXCLUDED',0,0,'retired',0,0)",
    );
    seedSyntheticOfficialCompletion(h, []);
    token = await jwt();
    h.env.BID_SESSION = {
      get: () => {
        throw new Error('Distribution must not mutate a Durable Object');
      },
    } as never;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await teardownTestD1(h);
  });

  it('generates deterministic frozen JSON/CSV with explicit external publication requirement and no writes', async () => {
    const before = h.sqlite.serialize();
    const state = (await (await request()).json()) as { packageSha256: string; status: string };
    expect(state.status).toBe('EXTERNAL_PUBLICATION_REQUIRED');
    const first = await request('/package/json');
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect(first.headers.get('Content-Disposition')).toMatch(/^attachment;/);
    const json = await first.json();
    expect(json).toMatchObject({
      packageSha256: state.packageSha256,
      externalPublication: 'REQUIRED_SEPARATELY',
      awards: [{ name: 'Historical Winner 101' }, { name: 'Historical Winner 202' }],
    });
    expect(await (await request('/package/json')).json()).toEqual(json);
    const csv = await request(`/package/csv?sha256=${state.packageSha256}`);
    expect(await csv.text()).toContain('Historical Winner 101');
    expect((await request(`/package/csv?sha256=${'0'.repeat(64)}`)).status).toBe(409);
    const after = h.sqlite.serialize();
    expect(
      after.length === before.length && after.every((byte, index) => byte === before[index]),
    ).toBe(true);
  }, 15000);

  it('neutralizes formula prefixes in CSV labels without changing the canonical package', async () => {
    const value = await loadBidResultPackage(h.env.DB, session);
    if (!value.ok) throw new Error(value.error);
    const award = value.document.awards[0];
    if (!award) throw new Error('Synthetic award missing');
    award.name = '=HYPERLINK("synthetic")';
    const csv = bidResultPackageCsv(value);
    expect(csv).toContain("'=HYPERLINK");
  });

  it('records evidence with exact retry identity, keeps corrections immutable, and never sends externally', async () => {
    const body = await reviewBody();
    const first = await request('/reviews', body);
    expect(first.status).toBe(201);
    const result = await first.json();
    expect(await (await request('/reviews', body)).json()).toEqual({
      ...(result as object),
      replayed: true,
    });
    expect((await request('/reviews', { ...body, reason: 'Different request' })).status).toBe(409);
    expect(
      (await request('/reviews', { ...body, channel: 'TARGETSOLUTIONS' }, 'bulletin')).status,
    ).toBe(201);
    expect(await (await request()).json()).toMatchObject({
      status: 'EXTERNAL_EVIDENCE_RECORDED',
      externalDeliveryPerformed: false,
    });
    expect(
      (
        await request(
          '/reviews',
          {
            ...body,
            expectedRevision: 1,
            status: 'REQUIRES_FOLLOW_UP',
            publishedOn: null,
            evidenceRef: 'Synthetic correction record',
          },
          'correction',
        )
      ).status,
    ).toBe(201);
    expect(await (await request()).json()).toMatchObject({
      status: 'EXTERNAL_PUBLICATION_REQUIRED',
    });
    expect(count('bid_result_distribution_reviews').n).toBe(3);
    expect(() => h.sqlite.exec('DELETE FROM bid_result_distribution_reviews')).toThrow(/immutable/);
    expect(() =>
      h.sqlite.exec("UPDATE bid_result_distribution_reviews SET reason='changed'"),
    ).toThrow(/immutable/);
  });

  it('requires admin, step-up, frozen publication permission, and a real completed run', async () => {
    const body = await reviewBody();
    expect((await request('', undefined, '', null)).status).toBe(401);
    expect((await request('', undefined, '', await jwt('member'))).status).toBe(403);
    expect((await request('/reviews', body, 'stale-auth', await jwt('admin', false))).status).toBe(
      401,
    );
    expect(
      (await request('/reviews', body, 'unauthorized', await jwt('admin', true, 0))).status,
    ).toBe(403);
    expect((await request('', undefined, '', token, 'mock-newer')).status).toBe(409);
    expect((await request('/reviews', body, 'mock-review', token, 'mock-newer')).status).toBe(409);
    expect(count('bid_result_distribution_reviews').n).toBe(0);
  });

  it('rejects missing evidence, future dates, stale package hashes and revisions', async () => {
    const body = await reviewBody();
    for (const invalid of [
      { evidenceRef: '' },
      { publishedOn: '2027-02-04' },
      { publishedOn: '2027-01-30' },
    ])
      expect((await request('/reviews', { ...body, ...invalid })).status).toBe(400);
    for (const invalid of [
      { packageSha256: '0'.repeat(64) },
      { expectedCompletionSeq: 11 },
      { expectedRevision: 2 },
    ])
      expect((await request('/reviews', { ...body, ...invalid })).status).toBe(409);
    expect(count('bid_result_distribution_reviews').n).toBe(0);
    expect(count('admin_configuration_receipts').n).toBe(0);
  });

  it('rolls back evidence and audit if receipt storage fails', async () => {
    const body = await reviewBody();
    const beforeAudit = count('audit_log').n;
    h.failNextBatchAt(2);
    expect((await request('/reviews', body)).status).toBe(409);
    expect(count('bid_result_distribution_reviews').n).toBe(0);
    expect(count('audit_log').n).toBe(beforeAudit);
  });

  it('rejects a canonical sequence race atomically after package read', async () => {
    const body = await reviewBody();
    const beforeAudit = count('audit_log').n;
    const batch = h.env.DB.batch.bind(h.env.DB);
    vi.spyOn(h.env.DB, 'batch').mockImplementationOnce(async (statements) => {
      h.sqlite
        .prepare('UPDATE canonical_bid_session_state SET current_seq=13 WHERE bid_session_id=?')
        .run(session);
      return batch(statements);
    });
    expect((await request('/reviews', body)).status).toBe(409);
    expect(count('bid_result_distribution_reviews').n).toBe(0);
    expect(count('audit_log').n).toBe(beforeAudit);
    expect(count('admin_configuration_receipts').n).toBe(0);
  });
});
