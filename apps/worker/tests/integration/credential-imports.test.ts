import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import writeXlsxFile, { type SheetData } from 'write-excel-file/node';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';
type Preview = {
  previewKey: string;
  sourceRevision: number;
  sourceHash: string;
  ready: boolean;
  rows: { name: string; operation: string; fyPointsDefault: number }[];
  errors: { rowNumber: number; message: string }[];
};
describe('staged credential catalog imports', () => {
  let h: TestD1;
  let token: string;
  const request = (path: string, body: BodyInit, key: string, contentType?: string) =>
    app.fetch(
      new Request(`http://x/api/admin/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': key,
          ...(contentType ? { 'Content-Type': contentType } : {}),
        },
        body,
      }),
      h.env,
    );
  async function preview(rows: unknown[][], key = 'preview', mode = 'normalized', metadata = 0) {
    const workbook = await writeXlsxFile(rows as SheetData);
    const buffer = await workbook.toBuffer();
    const bytes = new Uint8Array(buffer);
    const form = new FormData();
    form.append('file', new Blob([bytes]), 'synthetic-catalog.xlsx');
    form.append('mode', mode);
    form.append('metadata_columns', String(metadata));
    const response = await request('credential-imports/preview', form, key);
    expect(response.status).toBe(200);
    return (await response.json()) as Preview;
  }
  function commit(p: Preview, key = 'commit', patch = {}) {
    return request(
      'credential-imports/commit',
      JSON.stringify({
        preview_key: p.previewKey,
        expected_source_revision: p.sourceRevision,
        accept: true,
        source_ref: 'Synthetic reviewed catalog source',
        reason: 'Synthetic catalog import acceptance',
        ...patch,
      }),
      key,
      'application/json',
    );
  }
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(
      "INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at) VALUES (100,'synthetic-100','Synthetic','Admin','FF','FF',100,0,1,1)",
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
  it('shows parsing errors without partially importing the valid rows', async () => {
    const p = await preview([
      ['name', 'fy_points_default'],
      ['Synthetic valid', 3],
      ['', 1],
    ]);
    expect(p.ready).toBe(false);
    expect(p.errors[0]?.rowNumber).toBe(3);
    expect((await commit(p)).status).toBe(409);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM credentials').get()).toEqual({ n: 0 });
    expect(JSON.stringify(p)).not.toContain('"raw"');
  });
  it('reviews inserts and updates, applies them atomically and replays the original counts', async () => {
    h.sqlite.exec(
      "INSERT INTO credentials (id,name,fy_points_default) VALUES (1,'Synthetic existing',3)",
    );
    const p = await preview([
      ['name', 'fy_points_default'],
      ['Synthetic existing', 5],
      ['Synthetic new', 2],
    ]);
    expect(p.ready).toBe(true);
    expect(p.rows.map((r) => r.operation)).toEqual(['UPDATE', 'CREATE']);
    expect(
      h.sqlite.prepare('SELECT fy_points_default AS points FROM credentials WHERE id=1').get(),
    ).toEqual({ points: 3 });
    const first = await commit(p);
    expect(first.status).toBe(200);
    const saved = await first.json();
    expect(saved).toMatchObject({ inserted: 1, updated: 1, sourceHash: p.sourceHash });
    expect(await (await commit(p)).json()).toEqual({ ...(saved as object), replayed: true });
    expect((await commit(p, 'commit', { reason: 'Different reviewed reason' })).status).toBe(409);
    expect(
      h.sqlite
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='credentials_import'")
        .get(),
    ).toEqual({ n: 1 });
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  it('rolls back every row and the receipt when audit fails', async () => {
    const p = await preview([
      ['name', 'fy_points_default'],
      ['Synthetic first', 3],
      ['Synthetic second', 4],
    ]);
    h.failNextBatchAt(3);
    expect((await commit(p)).status).toBe(409);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM credentials').get()).toEqual({ n: 0 });
    expect(
      h.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM admin_configuration_receipts WHERE operation='credential.import.commit'",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect((await commit(p)).status).toBe(200);
  });
  it('rejects a changed catalog and duplicates before commit', async () => {
    const p = await preview([
      ['name', 'fy_points_default'],
      ['Synthetic first', 3],
    ]);
    h.sqlite.exec(
      "INSERT INTO credentials (name,fy_points_default) VALUES ('Synthetic concurrent',1)",
    );
    expect((await commit(p)).status).toBe(409);
    expect(h.sqlite.prepare('SELECT name FROM credentials').all()).toEqual([
      { name: 'Synthetic concurrent' },
    ]);
    const duplicate = await preview(
      [
        ['name', 'fy_points_default'],
        ['Synthetic duplicate', 3],
        ['synthetic DUPLICATE', 4],
      ],
      'duplicate',
    );
    expect(duplicate.ready).toBe(false);
    expect(duplicate.errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
  });
  it('extracts only reviewed wide-matrix headers and preserves existing default points', async () => {
    h.sqlite.exec(
      "INSERT INTO credentials (name,fy_points_default) VALUES ('Synthetic existing',9)",
    );
    const p = await preview(
      [
        ['Employee ID', 'Name', 'Synthetic existing', 'Synthetic new'],
        ['not-imported', 'not-imported', 1, 0],
      ],
      'wide',
      'legacy_wide_matrix',
      2,
    );
    expect(p.rows).toMatchObject([
      { name: 'Synthetic existing', fyPointsDefault: 9, operation: 'UNCHANGED' },
      { name: 'Synthetic new', fyPointsDefault: 0, operation: 'CREATE' },
    ]);
    expect((await commit(p)).status).toBe(200);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM member_credentials').get()).toEqual({
      n: 0,
    });
  });
});
