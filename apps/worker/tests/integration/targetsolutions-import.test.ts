import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';
const KEY = 't'.repeat(64);
describe('TargetSolutions reviewed import', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(
      "INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at) VALUES (1,'0012','Test','Member','FF','FF',1,0,1,1); INSERT INTO credentials(id,name) VALUES(10,'Synthetic Certification');",
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });
  async function request(path: string, body?: unknown) {
    const token = await signJwt(
      {
        sub: 0,
        emp: 'synthetic-import-admin',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Test',
        last_name: 'Admin',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      KEY,
    );
    return app.fetch(
      new Request(`http://x/api/admin/targetsolutions${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
  }
  const csv =
    'Credentials\nRun Date:,"Sep 7, 2026 4:34 PM"\nFilters:,Credential Status,Active\nFirst Name,Last Name,Employee ID,Credential Name\nTest,Member,0012,Synthetic Certification\nTest,Unknown,0999,Synthetic Certification';
  it('matches exact IDs, applies approved evidence once and preserves unresolved rows on replay', async () => {
    const upload = await request('/imports', { csv, filename: 'test.csv' });
    expect(upload.status).toBe(201);
    const { id } = (await upload.json()) as { id: string };
    expect((await request(`/imports/${id}/review`, { accept: true })).status).toBe(200);
    const preview = (await (await request(`/imports/${id}`)).json()) as {
      counts: Record<string, number>;
    };
    expect(preview.counts).toMatchObject({ NEW_QUALIFICATION: 1, UNKNOWN_MEMBER: 1 });
    expect(
      (await request(`/imports/${id}/apply`, { safe: true, reason: 'Reviewed synthetic import' }))
        .status,
    ).toBe(200);
    expect((await request('/imports', { csv, filename: 'test.csv' })).status).toBe(200);
    await request(`/imports/${id}/review`, { accept: true });
    await request(`/imports/${id}/apply`, { safe: true, reason: 'Retry synthetic import' });
    const count = await h.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM member_qualification_events',
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
    const legacy = await h.env.DB.prepare('SELECT COUNT(*) AS n FROM member_credentials').first<{
      n: number;
    }>();
    expect(legacy?.n).toBe(0);
  });
  it('does not apply an unreviewed batch', async () => {
    const { id } = (await (await request('/imports', { csv, filename: 'test.csv' })).json()) as {
      id: string;
    };
    expect(
      (await request(`/imports/${id}/apply`, { safe: true, reason: 'Attempt without review' }))
        .status,
    ).toBe(409);
  });

  it('preserves known dates on active-only imports and fills a missing date without duplicating the qualification', async () => {
    await h.db.run(
      "INSERT INTO member_credentials(member_id,credential_id,start_date,expiration_date) VALUES(1,10,'2025-01-01','2027-01-01')",
    );
    const { id } = (await (await request('/imports', { csv, filename: 'active.csv' })).json()) as {
      id: string;
    };
    await request(`/imports/${id}/review`, { accept: true });
    const preview = (await (await request(`/imports/${id}`)).json()) as {
      counts: Record<string, number>;
    };
    expect(preview.counts.UNCHANGED).toBe(1);
    await request(`/imports/${id}/apply`, { safe: true, reason: 'Preserve known expiration' });
    expect(
      (
        await h.env.DB.prepare('SELECT COUNT(*) n FROM member_qualification_events').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
    const renewal =
      'Employee ID,Credential Name,Credential Status,Expiration Date\n0012,Synthetic Certification,Active,2028-01-01';
    const next = (await (
      await request('/imports', {
        csv: renewal,
        filename: 'renewal.csv',
        observed_on: '2026-09-07',
      })
    ).json()) as { id: string };
    await request(`/imports/${next.id}/review`, { accept: true });
    expect(
      (await request(`/imports/${next.id}/apply`, { safe: true, reason: 'Reviewed renewal date' }))
        .status,
    ).toBe(200);
    const event = await h.env.DB.prepare(
      'SELECT kind,effective_on,expires_on FROM member_qualification_events',
    ).first();
    expect(event).toMatchObject({
      kind: 'CERTIFICATION_GAINED',
      effective_on: '2025-01-01',
      expires_on: '2028-01-01',
    });
    await request(`/imports/${next.id}/review`, { accept: true });
    await request(`/imports/${next.id}/apply`, { safe: true, reason: 'Repeat reviewed renewal' });
    expect(
      (
        await h.env.DB.prepare('SELECT COUNT(*) n FROM member_qualification_events').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
  });

  it('requires explicit adverse approval', async () => {
    const adverse =
      'Employee ID,Credential Name,Credential Status,Expiration Date\n0012,Synthetic Certification,Expired,2026-08-01';
    const { id } = (await (
      await request('/imports', {
        csv: adverse,
        filename: 'expired.csv',
        observed_on: '2026-09-07',
      })
    ).json()) as { id: string };
    await request(`/imports/${id}/review`, { accept: true });
    const detail = (await (await request(`/imports/${id}`)).json()) as { rows: { id: string }[] };
    const row = detail.rows[0];
    if (!row) throw new Error('Expected source row');
    expect(
      (
        await request(`/imports/${id}/apply`, {
          row_ids: [row.id],
          reason: 'Review without approval',
        })
      ).status,
    ).toBe(409);
    await request(`/imports/${id}/apply`, { safe: true, reason: 'Only safe changes approved' });
    expect(
      (
        await h.env.DB.prepare('SELECT COUNT(*) n FROM member_qualification_events').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
    expect(
      (
        await request(`/imports/${id}/apply`, {
          row_ids: [row.id],
          accept_adverse: true,
          reason: 'Source expiration verified',
        })
      ).status,
    ).toBe(200);
    expect(
      await h.env.DB.prepare('SELECT kind,effective_on FROM member_qualification_events').first(),
    ).toMatchObject({ kind: 'CERTIFICATION_EXPIRED', effective_on: '2026-08-02' });
  });

  it('rolls back a failed apply group without leaving a qualification or completed source row', async () => {
    const { id } = (await (
      await request('/imports', { csv, filename: 'rollback.csv' })
    ).json()) as { id: string };
    await request(`/imports/${id}/review`, { accept: true });
    h.failNextBatchAt(2);
    expect(
      (await request(`/imports/${id}/apply`, { safe: true, reason: 'Synthetic interrupted group' }))
        .status,
    ).toBe(409);
    expect(
      (
        await h.env.DB.prepare('SELECT COUNT(*) n FROM member_qualification_events').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
    expect(
      (
        await h.env.DB.prepare(
          'SELECT COUNT(*) n FROM targetsolutions_rows WHERE applied_at IS NOT NULL',
        ).first<{ n: number }>()
      )?.n,
    ).toBe(0);
    expect(
      (await request(`/imports/${id}/apply`, { safe: true, reason: 'Retry interrupted group' }))
        .status,
    ).toBe(200);
  });

  it('blocks a stale review after a member qualification is changed', async () => {
    const { id } = (await (await request('/imports', { csv, filename: 'stale.csv' })).json()) as {
      id: string;
    };
    await request(`/imports/${id}/review`, { accept: true });
    await h.db.run(
      "INSERT INTO member_credentials(member_id,credential_id,start_date,expiration_date) VALUES(1,10,'2025-01-01','2026-01-01')",
    );
    expect(
      (await request(`/imports/${id}/apply`, { safe: true, reason: 'Stale source review attempt' }))
        .status,
    ).toBe(409);
    expect(
      (
        await h.env.DB.prepare('SELECT COUNT(*) n FROM member_qualification_events').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
  });

  it('requires explicit catalog classification for unknown names and never creates a person', async () => {
    const source = csv.replaceAll('Synthetic Certification', 'Synthetic new qualification');
    const { id } = (await (
      await request('/imports', { csv: source, filename: 'mapping.csv' })
    ).json()) as { id: string };
    await request(`/imports/${id}/review`, { accept: true });
    const result = await request('/mappings', {
      source_name: 'Synthetic new qualification',
      create_new: true,
      reason: 'Verified distinct qualification',
    });
    expect(result.status).toBe(200);
    await request(`/imports/${id}/review`, { accept: true });
    await request(`/imports/${id}/apply`, { safe: true, reason: 'Reviewed mapped qualification' });
    expect(
      (await h.env.DB.prepare('SELECT COUNT(*) n FROM members').first<{ n: number }>())?.n,
    ).toBe(1);
    expect(
      await h.env.DB.prepare(
        "SELECT fy_points_default FROM credentials WHERE name='Synthetic new qualification'",
      ).first(),
    ).toMatchObject({ fy_points_default: 0 });
  });
  it('registers a reviewed set of distinct names once without awarding catalog points', async () => {
    const text = csv.replaceAll('Synthetic Certification', 'New distinct certification');
    const { id } = (await (
      await request('/imports', { csv: text, filename: 'new.csv' })
    ).json()) as { id: string };
    await request(`/imports/${id}/review`, {});
    expect(
      (
        await request(`/imports/${id}/register-names`, {
          names: ['New distinct certification'],
          reason: 'Reviewed distinct synthetic definition',
          confirm_distinct: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/imports/${id}/register-names`, {
          names: ['New distinct certification'],
          reason: 'Replay registration',
          confirm_distinct: true,
        })
      ).status,
    ).toBe(409);
    expect(
      await h.env.DB.prepare('SELECT fy_points_default AS points FROM credentials WHERE name=?')
        .bind('New distinct certification')
        .first(),
    ).toEqual({ points: 0 });
    await request(`/imports/${id}/review`, {});
    expect(
      (
        await request(`/imports/${id}/apply`, {
          safe: true,
          reason: 'Apply reviewed synthetic definition',
        })
      ).status,
    ).toBe(200);
  });
  it('preserves and revises a mapping without reassigning already applied evidence', async () => {
    await request('/mappings', {
      source_name: 'Another source name',
      credential_id: 10,
      reason: 'Reviewed first mapping',
    });
    const catalog = (await (await request('/catalog')).json()) as {
      mappings: { created_at: number }[];
    };
    const rev = catalog.mappings[0]?.created_at;
    expect(rev).toBeTypeOf('number');
    expect(
      (
        await request('/mappings', {
          source_name: 'Another source name',
          reference_only: true,
          reason: 'Corrected classification',
          expected_mapping_revision: rev,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request('/mappings', {
          source_name: 'Another source name',
          credential_id: 10,
          reason: 'Stale correction attempt',
          expected_mapping_revision: rev,
        })
      ).status,
    ).toBe(409);
    expect(
      await h.env.DB.prepare('SELECT COUNT(*) AS n FROM targetsolutions_mapping_history').first(),
    ).toEqual({ n: 1 });
  });
  it('retains rejected source assertions in their own review category without changing qualifications', async () => {
    const { id } = (await (await request('/imports', { csv, filename: 'reject.csv' })).json()) as {
      id: string;
    };
    await request(`/imports/${id}/review`, {});
    const detail = (await (await request(`/imports/${id}`)).json()) as { rows: { id: string }[] };
    const row = detail.rows[0];
    if (!row) throw new Error('Missing fixture row');
    expect(
      (
        await request(`/imports/${id}/reject`, {
          row_ids: [row.id],
          reason: 'Source assertion not accepted',
        })
      ).status,
    ).toBe(200);
    const result = (await (await request(`/imports/${id}?category=REJECTED`)).json()) as {
      counts: Record<string, number>;
      rows: unknown[];
    };
    expect(result.counts.REJECTED).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(
      await h.env.DB.prepare('SELECT COUNT(*) AS n FROM member_qualification_events').first(),
    ).toEqual({ n: 0 });
  });
});
