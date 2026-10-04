import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  BidFormArchive,
  BidFormReceipt,
  MemberBidFormResponse,
} from '../../src/lib/bid-form-source.js';
import { signJwt } from '../../src/lib/jwt.js';
import adminBidForms from '../../src/routes/admin/bid-forms.js';
import type { WorkerEnv } from '../../src/types/env.js';
import {
  SHIFT_EXPORT_SESSION,
  shiftExportFixture,
} from '../exports/helpers/shift-roster-fixture.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const archive = (): BidFormArchive => ({
  v: 1,
  year: 2026,
  source: { name: 'Synthetic forms.xlsx', sha256: 'a'.repeat(64) },
  forms: [
    {
      employeeId: 'PRIVATE_EMPLOYEE_1',
      sourceName: 'Member & Saved,Frozen <Captain>',
      sourceRank: 'Captain',
      attendingTeams: 'Yes',
      phone1: 'synthetic private contact',
      phone2: null,
      positionPreferences: [
        { order: 1, shift: 'A Shift', unit: '<script>source text only</script>' },
      ],
      aDayPreferences: [{ order: 1, sourceLabel: 'A Group 1', shift: 'A', group: 'G1' }],
      sourceLocation: { sheet: 'Forms', row: 3 },
    },
  ],
  notSubmitted: [],
  unlinkedNotSubmitted: [],
});

function firstForm(source: BidFormArchive) {
  const form = source.forms[0];
  if (!form) throw new Error('Synthetic form missing');
  return form;
}

describe('private documentary bid form archive', () => {
  let h: TestD1;
  let token: string;
  let objects: Map<string, string>;
  let blockHeadWrite: boolean;
  const app = new Hono<{ Bindings: WorkerEnv }>().route('/api/admin/bid-forms', adminBidForms);
  const request = (
    path = `/2026/members/1?session_id=${SHIFT_EXPORT_SESSION}`,
    method = 'GET',
    body?: unknown,
    jwt?: string,
  ) =>
    app.request(
      `/api/admin/bid-forms${path}`,
      {
        method,
        headers: { Authorization: `Bearer ${jwt ?? token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      h.env,
    );
  const publish = (value = archive(), expectedArchiveSha256?: string) =>
    request('', 'POST', {
      archive: value,
      ...(expectedArchiveSha256 === undefined ? {} : { expectedArchiveSha256 }),
    });
  const databaseHash = () =>
    createHash('sha256').update(new Uint8Array(h.sqlite.serialize())).digest('hex');

  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.exec(`INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at) VALUES
      (1,'current-mutable-id','Mutable','Current','CPT','OFC',1,0,1,1),
      (3,'admin','Synthetic','Admin','CPT','OFC',3,0,1,1);
      INSERT INTO bid_years(year,status) VALUES(2026,'live');
      INSERT INTO position_templates(version,effective_year) VALUES('2026.export-topology',2026);
      INSERT INTO rule_books(version,effective_year,status,revision) VALUES('2026.export-test',2026,'draft',0);
      INSERT INTO bid_sessions(id,bid_year,started_at,current_phase,turn_timer_seconds,expected_duration_days,day_count,is_mock)
      VALUES('${SHIFT_EXPORT_SESSION}',2026,1,'position_bid',180,2,1,1);`);
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
      (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at)
      VALUES(?,'2026.export-test','2026.export-topology',0,?,1)`,
      [SHIFT_EXPORT_SESSION, JSON.stringify(shiftExportFixture().snapshot)],
    );
    token = await signJwt(
      {
        sub: 0,
        emp: 'admin',
        role: 'admin',
        rank: 'CPT',
        first_name: 'Synthetic',
        last_name: 'Admin',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
    objects = new Map();
    blockHeadWrite = false;
    h.env.R2_EXPORTS = {
      get: async (key: string) =>
        objects.has(key)
          ? {
              etag: createHash('sha256')
                .update(objects.get(key) ?? '')
                .digest('hex'),
              json: async () => JSON.parse(objects.get(key) ?? ''),
            }
          : null,
      put: async (key: string, value: string, options: R2PutOptions) => {
        if (blockHeadWrite && key === 'bid-forms/v1/2026.json') return null;
        if (options.onlyIf instanceof Headers) {
          expect(options.onlyIf.get('If-None-Match')).toBe('*');
          if (objects.has(key)) return null;
        } else if (
          options.onlyIf?.etagMatches !==
          createHash('sha256')
            .update(objects.get(key) ?? '')
            .digest('hex')
        )
          return null;
        objects.set(key, value);
        return { key };
      },
    } as unknown as typeof h.env.R2_EXPORTS;
  });
  afterEach(async () => teardownTestD1(h));

  it('requires admin authorization for reads and publication without revealing private source values', async () => {
    expect((await request(undefined, 'GET', undefined, 'invalid')).status).toBe(401);
    const member = await signJwt(
      {
        sub: 0,
        emp: 'admin',
        role: 'member',
        rank: 'FF',
        first_name: 'Synthetic',
        last_name: 'Member',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
    expect((await request(undefined, 'GET', undefined, member)).status).toBe(403);
    expect((await request('', 'POST', { archive: archive() }, member)).status).toBe(403);
    expect(objects.size).toBe(0);
  });
  it.each(
    [true, false].flatMap((isMock) =>
      ['config', 'position_bid', 'a_day_bid', 'paused', 'complete'].map(
        (phase) => [isMock, phase] as const,
      ),
    ),
  )(
    'publishes once and reads frozen identity in Mock=%s phase=%s without a database write',
    async (isMock, phase) => {
      h.sqlite
        .prepare('UPDATE bid_sessions SET is_mock=?,current_phase=?')
        .run(isMock ? 1 : 0, phase);
      const before = databaseHash();
      expect((await publish()).status).toBe(201);
      const read = await request();
      expect(read.status).toBe(200);
      expect(read.headers.get('Cache-Control')).toBe('private, no-store');
      const result = (await read.json()) as MemberBidFormResponse;
      expect(result.status).toBe('SUBMITTED');
      expect(result.form?.employeeId).toBe('PRIVATE_EMPLOYEE_1');
      expect(result.form?.positionPreferences[0]?.unit).toBe('<script>source text only</script>');
      expect((await request('/2026/members/1')).status).toBe(200);
      expect(
        ((await (await request('/2026/members/1')).json()) as MemberBidFormResponse).status,
      ).toBe('NOT_LISTED');
      expect(databaseHash()).toBe(before);
    },
  );
  it('retains immutable revisions, requires expected hash for an update and supports identical retry', async () => {
    const first = await publish();
    const old = (await first.json()) as { sha256: string };
    expect((await publish()).status).toBe(200);
    const changed = archive();
    firstForm(changed).attendingTeams = 'No';
    expect((await publish(changed)).status).toBe(409);
    expect((await publish(changed, 'f'.repeat(64))).status).toBe(409);
    expect((await publish(changed, old.sha256)).status).toBe(201);
    const newReceipt = JSON.parse(objects.get('bid-forms/v1/2026.json') ?? '') as BidFormReceipt;
    expect(newReceipt.archive.forms[0]?.attendingTeams).toBe('No');
    expect(objects.has(`bid-forms/v1/revisions/2026/${old.sha256}.json`)).toBe(true);
    expect(objects.has(`bid-forms/v1/revisions/2026/${newReceipt.sha256}.json`)).toBe(true);
    expect((await publish(changed, old.sha256)).status).toBe(200);
  });
  it('failed concurrent current-pointer update preserves the previous published source', async () => {
    const old = (await (await publish()).json()) as { sha256: string };
    const headBefore = objects.get('bid-forms/v1/2026.json');
    const changed = archive();
    firstForm(changed).attendingTeams = 'No';
    blockHeadWrite = true;
    expect((await publish(changed, old.sha256)).status).toBe(409);
    expect(objects.get('bid-forms/v1/2026.json')).toBe(headBefore);
    expect(((await (await request()).json()) as MemberBidFormResponse).form?.attendingTeams).toBe(
      'Yes',
    );
  });
  it('shows source unavailable without claiming that a member did not submit', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'SOURCE_UNAVAILABLE',
      form: null,
      airTechReference: null,
    });
  });
  it('detects tampering and fails closed without returning any form fields', async () => {
    await publish();
    const current = JSON.parse(objects.get('bid-forms/v1/2026.json') ?? '') as BidFormReceipt;
    firstForm(current.archive).phone1 = 'tampered synthetic private value';
    objects.set('bid-forms/v1/2026.json', JSON.stringify(current));
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'bid_form_archive_integrity_failed' });
  });
  it.each([
    '/2026/members/0',
    '/2026/members/9007199254740992',
    '/1999/members/1',
    `/2026/members/1?session_id=${SHIFT_EXPORT_SESSION}&session_id=other`,
  ])('rejects invalid selection %s', async (path) => {
    expect((await request(path)).status).toBe(400);
  });
  it('requires matching session year and frozen identity, with no mutable-directory fallback', async () => {
    expect((await request(`/2027/members/1?session_id=${SHIFT_EXPORT_SESSION}`)).status).toBe(409);
    expect((await request('/2026/members/1?session_id=missing')).status).toBe(404);
    expect((await request(`/2026/members/900?session_id=${SHIFT_EXPORT_SESSION}`)).status).toBe(
      404,
    );
    h.sqlite.exec('DELETE FROM bid_session_policy_snapshots');
    expect((await request()).status).toBe(409);
  });
  it('rejects conflicting identities and limits validation output to field paths and error codes', async () => {
    const conflicting = archive();
    conflicting.forms.push({ ...firstForm(conflicting) });
    expect((await publish(conflicting)).status).toBe(409);
    const bad = archive();
    firstForm(bad).phone1 = 'private'.repeat(100);
    const response = await publish(bad);
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).not.toContain('privateprivate');
    expect(body).not.toContain('received');
    expect(objects.size).toBe(0);
  });
});
