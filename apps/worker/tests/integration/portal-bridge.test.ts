import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const SHARED = 'test-bid-reader-secret-do-not-use-in-prod';

describe('GET /api/portal/members/:employee_id/credentials', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    const now = Date.now();
    await h.db.run(
      `INSERT INTO members
        (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, rank_seniority, is_probationary, created_at, updated_at)
       VALUES
        (1, '14335', 'Jesus', 'Sola', 'CPT', 'OFC', 4, 4, 0, ?, ?),
        (2, '20001', 'John', 'Smith', 'FF', 'FF', 7, NULL, 0, ?, ?);`,
      [now, now, now, now],
    );
    await h.db.run(
      `INSERT INTO credentials (id, name) VALUES
        (1, 'Paramedic'),
        (2, 'Driver Engineer Qualified'),
        (3, 'Hazardous Materials Operations');`,
    );
    await h.db.run(
      'INSERT INTO member_credentials (member_id, credential_id) VALUES (1, 1), (1, 2), (1, 3);',
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('returns 503 when PORTAL_BID_READER is unconfigured', async () => {
    const res = await app.fetch(new Request('http://x/api/portal/members/14335/credentials'), {
      ...h.env,
      PORTAL_BID_READER: '',
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bridge_disabled');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await app.fetch(new Request('http://x/api/portal/members/14335/credentials'), {
      ...h.env,
      PORTAL_BID_READER: SHARED,
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong bearer token', async () => {
    const res = await app.fetch(
      new Request('http://x/api/portal/members/14335/credentials', {
        headers: { Authorization: 'Bearer wrong' },
      }),
      { ...h.env, PORTAL_BID_READER: SHARED },
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown employee_id', async () => {
    const res = await app.fetch(
      new Request('http://x/api/portal/members/NOT_REAL/credentials', {
        headers: { Authorization: `Bearer ${SHARED}` },
      }),
      { ...h.env, PORTAL_BID_READER: SHARED },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; employee_id: string };
    expect(body.error).toBe('employee_not_found');
    expect(body.employee_id).toBe('NOT_REAL');
  });

  it('returns sorted credential names + lastUpdated for valid request', async () => {
    const res = await app.fetch(
      new Request('http://x/api/portal/members/14335/credentials', {
        headers: { Authorization: `Bearer ${SHARED}` },
      }),
      { ...h.env, PORTAL_BID_READER: SHARED },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      employee_id: string;
      credentials: string[];
      lastUpdated: string | null;
    };
    expect(body.employee_id).toBe('14335');
    // Sorted alphabetically.
    expect(body.credentials).toEqual([
      'Driver Engineer Qualified',
      'Hazardous Materials Operations',
      'Paramedic',
    ]);
    // lastUpdated is an ISO string (timestamp stored as ms epoch).
    expect(typeof body.lastUpdated).toBe('string');
  });

  it('returns an empty credentials array for a member with no certs', async () => {
    const res = await app.fetch(
      new Request('http://x/api/portal/members/20001/credentials', {
        headers: { Authorization: `Bearer ${SHARED}` },
      }),
      { ...h.env, PORTAL_BID_READER: SHARED },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { credentials: string[] };
    expect(body.credentials).toEqual([]);
  });
});
