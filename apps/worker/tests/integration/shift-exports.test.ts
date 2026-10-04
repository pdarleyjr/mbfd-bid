import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import readXlsxFile from 'read-excel-file/universal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signJwt } from '../../src/lib/jwt.js';
import adminExports from '../../src/routes/admin/exports.js';
import type { WorkerEnv } from '../../src/types/env.js';
import {
  SHIFT_EXPORT_SESSION,
  shiftExportFixture,
} from '../exports/helpers/shift-roster-fixture.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const mocks = vi.hoisted(() => {
  const page = {
    setJavaScriptEnabled: vi.fn(async () => undefined),
    setContent: vi.fn(async () => undefined),
    pdf: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
  };
  const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => undefined) };
  return { page, browser, launch: vi.fn(async () => browser) };
});
vi.mock('@cloudflare/puppeteer', () => ({ default: { launch: mocks.launch } }));

describe('read-only shift export downloads', () => {
  let h: TestD1;
  let jwt: string;
  const app = new Hono<{ Bindings: WorkerEnv }>().route('/api/admin/exports', adminExports);
  const url = (query = 'format=xlsx&shift=ALL', id = SHIFT_EXPORT_SESSION) =>
    `/api/admin/exports/${id}/shifts?${query}`;
  const request = (query?: string, id?: string, env?: WorkerEnv) =>
    app.request(url(query, id), { headers: { Authorization: `Bearer ${jwt}` } }, env ?? h.env);
  const seedState = async (state: unknown = shiftExportFixture().state) => {
    await h.db.run(
      `INSERT INTO canonical_bid_session_state
      (bid_session_id,current_seq,state_json,last_command_id,created_at,updated_at)
      VALUES(?,7,?,NULL,1,1)`,
      [SHIFT_EXPORT_SESSION, JSON.stringify(state)],
    );
  };

  beforeEach(async () => {
    mocks.launch.mockClear();
    mocks.page.setContent.mockClear();
    mocks.browser.close.mockClear();
    h = await setupTestD1();
    const fixture = shiftExportFixture();
    h.sqlite.exec(`INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at) VALUES
      (3,'admin','Current Mutable','Directory','CPT','OFC',3,0,1,1);
      INSERT INTO bid_years(year,status) VALUES(2026,'live');
      INSERT INTO position_templates(version,effective_year) VALUES('2026.export-topology',2026);
      INSERT INTO rule_books(version,effective_year,status,revision) VALUES('2026.export-test',2026,'draft',0);
      INSERT INTO bid_sessions(id,bid_year,started_at,current_phase,turn_timer_seconds,expected_duration_days,day_count,is_mock)
      VALUES('${SHIFT_EXPORT_SESSION}',2026,1,'position_bid',180,2,1,1);`);
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
      (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at)
      VALUES(?,'2026.export-test','2026.export-topology',0,?,1)`,
      [SHIFT_EXPORT_SESSION, JSON.stringify(fixture.snapshot)],
    );
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CPT',
      first_name: 'Synthetic',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    };
    jwt = await signJwt(payload, h.env.JWT_SIGNING_KEY);
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('requires the ordinary administrator session', async () => {
    const response = await app.request(url(), {}, h.env);
    expect(response.status).toBe(401);
  });

  it.each([['format=csv&shift=ALL'], ['format=xlsx&shift=Z'], ['shift=A']])(
    'rejects an invalid selection %s',
    async (query) => {
      const response = await request(query);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_export_selection' });
    },
  );

  it.each([0, 1])(
    'downloads complete native workbooks mid-bid for isMock=%s without any writes',
    async (isMock) => {
      await h.db.run('UPDATE bid_sessions SET is_mock=? WHERE id=?', [
        isMock,
        SHIFT_EXPORT_SESSION,
      ]);
      await seedState();
      const before = h.sqlite.prepare('SELECT * FROM canonical_bid_session_state').all();
      const response = await request();
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="mbfd-${isMock ? 'mock' : 'real'}-bid-2026-ALL-seq-7.xlsx"`,
      );
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('x-mbfd-bid-sequence')).toBe('7');
      const sheets = await readXlsxFile(await response.arrayBuffer());
      expect(sheets.map((s) => s.sheet)).toEqual(['A Shift', 'B Shift', 'C Shift', 'Days']);
      expect(
        sheets.flatMap((s) => s.data).filter((row) => /^[ABCD]\d{3}$/.test(String(row[0]))),
      ).toHaveLength(5);
      expect(JSON.stringify(sheets)).toContain('Frozen <Captain> Member & Saved');
      expect(JSON.stringify(sheets)).not.toMatch(
        /Current Mutable|PRIVATE_EMPLOYEE|DO_NOT_EXPORT_PRIVATE_QUALIFICATION/,
      );
      expect(h.sqlite.prepare('SELECT * FROM canonical_bid_session_state').all()).toEqual(before);
      expect(h.sqlite.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({
        count: 0,
      });
    },
  );

  it.each(['config', 'position_bid', 'a_day_bid', 'paused', 'complete'] as const)(
    'does not require completion: %s',
    async (phase) => {
      const state = { ...shiftExportFixture().state, currentPhase: phase };
      await seedState(state);
      const response = await request('format=xlsx&shift=A');
      expect(response.status).toBe(200);
      const sheets = await readXlsxFile(await response.arrayBuffer());
      expect(sheets.map((s) => s.sheet)).toEqual(['A Shift']);
      expect(sheets[0]?.data[1]?.[0]).toContain(phase.replaceAll('_', ' '));
    },
  );

  it('captures all shifts in one canonical read and passes that document to the PDF renderer', async () => {
    await seedState();
    const prepare = vi.spyOn(h.env.DB, 'prepare');
    const response = await request('format=pdf&shift=ALL', undefined, {
      ...h.env,
      BROWSER: { fetch: vi.fn() } as never,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(
      prepare.mock.calls.filter(([sql]) =>
        /SELECT current_seq, state_json, last_command_id/.test(sql),
      ),
    ).toHaveLength(1);
    const html = (mocks.page.setContent.mock.calls as unknown as Array<[string]>)[0]?.[0] ?? '';
    expect(html.match(/<section class="shift">/g)).toHaveLength(4);
    expect(html.match(/Sequence 7/g)).toHaveLength(4);
    expect(html).toContain('Frozen &lt;Captain&gt; Member &amp; Saved');
    expect(mocks.browser.close).toHaveBeenCalledTimes(1);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 });
  });

  it('returns an actionable error when PDF rendering is absent, with Excel still available', async () => {
    const response = await request('format=pdf&shift=A');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'browser_rendering_not_configured' });
    expect((await request('format=xlsx&shift=A')).status).toBe(200);
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it('fails closed on invalid canonical data rather than downloading a misleading document', async () => {
    await seedState({ bidSessionId: SHIFT_EXPORT_SESSION, lastSeq: 7, invalid: true });
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'canonical_state_invalid' });
  });

  it('returns not-found for a missing session', async () => {
    const response = await request(undefined, 'missing');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'session_not_found' });
  });
});
