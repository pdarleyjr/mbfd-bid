import { deepStrictEqual } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configurationReceiptStatement,
  loadConfigurationReceipt,
} from '../../src/lib/admin-configuration-receipt.js';
import { mutateAnnualPlan, replayAnnualPlanMutation } from '../../src/lib/annual-plan-mutation.js';
import { auditInsertStatement } from '../../src/lib/audit.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import {
  type SaveBidDefinitionInput,
  saveBidDefinition,
} from '../../src/lib/bid-definition-store.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);
const MIGRATION = '0062_bid_receipt_row_identity.sql';
const TABLES = ['admin_configuration_receipts', 'annual_plan_receipts'] as const;
type ReceiptTable = (typeof TABLES)[number];
const ACTOR = 10001;
const SUBJECT = 'synthetic-receipt-reviewer';

function receiptInsert(
  table: ReceiptTable,
  key: string,
  rowid?: number,
  verb = 'INSERT OR REPLACE',
  rowAlias = 'rowid',
) {
  const columns = [
    ...(rowid === undefined ? [] : [rowAlias]),
    'idempotency_key',
    'actor_subject',
    ...(table === 'admin_configuration_receipts' ? ['operation'] : []),
    'request_json',
    'response_json',
    'created_at',
  ];
  const parameters = [
    ...(rowid === undefined ? [] : [rowid]),
    key,
    SUBJECT,
    ...(table === 'admin_configuration_receipts' ? ['synthetic.identity'] : []),
    '{ "ordered": [2,1], "text": "Synthetic receipt evidence" }',
    '{ "recorded": true, "revision": 7 }',
    123456789,
  ];
  return {
    sql: `${verb} INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
    parameters,
  };
}

function migrateBeforeRowGuard(sqlite: Database.Database) {
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql') && name < MIGRATION)
    .sort())
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('recursive_triggers = OFF');
}

describe('pre-0062 receipt replacement characterization', () => {
  let sqlite: Database.Database;
  beforeEach(() => {
    sqlite = new Database(':memory:');
    migrateBeforeRowGuard(sqlite);
  });
  afterEach(() => sqlite.close());

  it.each(TABLES)('%s permits a different key to replace the same implicit rowid', (table) => {
    const original = receiptInsert(table, 'original', 101, 'INSERT');
    sqlite.prepare(original.sql).run(...original.parameters);
    const replacement = receiptInsert(table, 'replacement', 101);
    sqlite.prepare(replacement.sql).run(...replacement.parameters);
    expect(sqlite.prepare(`SELECT idempotency_key FROM ${table} WHERE rowid=101`).get()).toEqual({
      idempotency_key: 'replacement',
    });
    expect(
      sqlite.prepare(`SELECT 1 FROM ${table} WHERE idempotency_key='original'`).get(),
    ).toBeUndefined();
  });

  it('annual receipts also permit primary-key replacement without an explicit rowid', () => {
    const original = receiptInsert('annual_plan_receipts', 'original', 101, 'INSERT');
    sqlite.prepare(original.sql).run(...original.parameters);
    const replacement = receiptInsert('annual_plan_receipts', 'original');
    sqlite.prepare(replacement.sql).run(...replacement.parameters);
    const row = sqlite
      .prepare('SELECT rowid FROM annual_plan_receipts WHERE idempotency_key=?')
      .get('original') as { rowid: number };
    expect(row.rowid).not.toBe(101);
  });

  it.each(TABLES)('0062 preserves every preexisting %s row and serialized JSON value', (table) => {
    for (const [key, rowid] of [
      ['first', 101],
      ['second', 202],
    ] as const) {
      const insert = receiptInsert(table, key, rowid, 'INSERT');
      sqlite.prepare(insert.sql).run(...insert.parameters);
    }
    const before = JSON.stringify(
      sqlite.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all(),
    );
    sqlite.exec(readFileSync(new URL(MIGRATION, MIGRATIONS), 'utf8'));
    expect(
      JSON.stringify(sqlite.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()),
    ).toBe(before);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    const replacement = receiptInsert(table, 'replacement', 101);
    const bytes = sqlite.serialize();
    expect(() => sqlite.prepare(replacement.sql).run(...replacement.parameters)).toThrow(
      /immutable/,
    );
    deepStrictEqual(sqlite.serialize(), bytes);
  });
});

describe('immutable configuration and annual receipt row identities', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.pragma('recursive_triggers = OFF');
    h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
        VALUES (${ACTOR},'synthetic-receipt-reviewer','Synthetic','Reviewer','FF','FF',1,1,1);
      INSERT INTO position_templates (version,effective_year) VALUES ('2027.1',2027),('2028.1',2028);
      INSERT INTO rule_books (version,effective_year,status,revision) VALUES ('2027.1',2027,'draft',0),('2028.1',2028,'draft',0);
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',0,'{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-01"}'),
          (2028,'configuring','2028.1','2028.1',0,'{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2028-01-01","personnelEvaluationOn":"2028-01-01"}');
      INSERT INTO annual_plan_reviews (bid_year,effective_on,revision,created_at) VALUES (2028,'2028-01-01',0,1);
    `);
    for (const key of ['original', 'other']) {
      await writeAdmin(key);
      await writeAnnual(key);
    }
    expect(h.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(h.sqlite.pragma('recursive_triggers', { simple: true })).toBe(0);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  afterEach(async () => teardownTestD1(h));

  function adminInput(key: string) {
    return {
      key,
      actorSubject: SUBJECT,
      operation: 'synthetic.identity',
      request: { year: 2027, key },
    };
  }

  async function writeAdmin(key: string) {
    const input = adminInput(key);
    const prior = await loadConfigurationReceipt(h.env.DB, input);
    if (prior) return prior;
    const response = { year: 2027, receipt: key };
    await h.env.DB.batch([
      auditInsertStatement(h.env.DB, {
        bidSessionId: null,
        actorType: 'admin',
        actorId: ACTOR,
        action: 'bid_configuration_set',
        targetKind: 'bid_year',
        targetId: '2027',
        reason: 'Synthetic receipt identity fixture',
        afterState: response,
      }),
      configurationReceiptStatement(h.env.DB, input, response),
    ]);
    return { ok: true, response };
  }

  function annualInput(key: string) {
    return {
      year: 2028,
      key,
      actorSubject: SUBJECT,
      operation: 'synthetic.review',
      request: { reviewed: true, key },
    };
  }

  async function writeAnnual(key: string) {
    const source = h.sqlite
      .prepare('SELECT revision FROM annual_source_revision WHERE id=1')
      .get() as { revision: number };
    return mutateAnnualPlan(h.env.DB, {
      ...annualInput(key),
      actorId: ACTOR,
      body: {
        expected_rule_revision: 0,
        expected_configuration_revision: 0,
        expected_source_revision: source.revision,
      },
      response: { year: 2028, receipt: key },
      reason: 'Synthetic annual receipt identity fixture',
      statements: [],
    });
  }

  function rowid(table: ReceiptTable, key = 'original') {
    const row = h.sqlite.prepare(`SELECT rowid FROM ${table} WHERE idempotency_key=?`).get(key) as
      | { rowid: number }
      | undefined;
    if (!row) throw new Error(`Fixture receipt ${table}/${key} was not written`);
    return row.rowid;
  }

  function rejected(sql: string, parameters: unknown[] = []) {
    const before = h.sqlite.serialize();
    expect(() => h.sqlite.prepare(sql).run(...parameters)).toThrow(/immutable/);
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  }

  describe.each(TABLES)('%s', (table) => {
    it.each(['rowid', '_rowid_', 'oid'])(
      'rejects INSERT OR REPLACE by %s with a different key',
      (alias) => {
        const attack = receiptInsert(
          table,
          'replacement',
          rowid(table),
          'INSERT OR REPLACE',
          alias,
        );
        rejected(attack.sql, attack.parameters);
      },
    );

    it('rejects REPLACE syntax and a simultaneous key/rowid collision across two receipts', () => {
      const attack = receiptInsert(table, 'other', rowid(table), 'REPLACE');
      rejected(attack.sql, attack.parameters);
    });

    it('rejects key replacement without supplying rowid', () => {
      const attack = receiptInsert(table, 'original');
      rejected(attack.sql, attack.parameters);
    });

    it.each(['rowid', '_rowid_', 'oid'])(
      'rejects UPDATE OR REPLACE of %s from another receipt',
      (alias) => {
        rejected(`UPDATE OR REPLACE ${table} SET ${alias}=? WHERE idempotency_key='other'`, [
          rowid(table),
        ]);
      },
    );

    it('rejects row identity movement even when the destination is unoccupied', () => {
      rejected(`UPDATE ${table} SET rowid=777777 WHERE idempotency_key='original'`);
    });

    it('retains existing key-update, content-update, UPSERT and delete protection', () => {
      rejected(
        `UPDATE OR REPLACE ${table} SET idempotency_key='original' WHERE idempotency_key='other'`,
      );
      rejected(
        `UPDATE ${table} SET response_json='{"forged":true}' WHERE idempotency_key='original'`,
      );
      const upsert = receiptInsert(table, 'original', undefined, 'INSERT');
      rejected(
        `${upsert.sql} ON CONFLICT(idempotency_key) DO UPDATE SET response_json=excluded.response_json`,
        upsert.parameters,
      );
      rejected(`DELETE FROM ${table} WHERE idempotency_key='original'`);
    });

    it('accepts a fresh explicitly assigned rowid and preserves every earlier receipt', () => {
      const before = h.sqlite.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all();
      const insert = receiptInsert(table, 'new-key', 777777, 'INSERT');
      h.sqlite.prepare(insert.sql).run(...insert.parameters);
      expect(
        h.sqlite
          .prepare(`SELECT rowid,* FROM ${table} WHERE idempotency_key<>'new-key' ORDER BY rowid`)
          .all(),
      ).toEqual(before);
      expect(rowid(table, 'new-key')).toBe(777777);
    });

    it('rolls earlier changes back when a receipt collision rejects a D1 batch', async () => {
      const attack = receiptInsert(table, 'replacement', rowid(table));
      const before = h.sqlite.serialize();
      await expect(
        h.env.DB.batch([
          h.env.DB.prepare(
            'UPDATE annual_plan_reviews SET revision=revision+1 WHERE bid_year=2028',
          ),
          h.env.DB.prepare(attack.sql).bind(...attack.parameters),
        ]),
      ).rejects.toThrow(/immutable/);
      deepStrictEqual(h.sqlite.serialize(), before);
    });
  });

  it('preserves normal helper inserts, exact replay and actor/request/operation key isolation', async () => {
    expect(await writeAdmin('new-admin')).toEqual({
      ok: true,
      response: { year: 2027, receipt: 'new-admin' },
    });
    expect(await writeAnnual('new-annual')).toEqual({
      ok: true,
      replayed: false,
      response: { year: 2028, receipt: 'new-annual' },
    });
    const before = h.sqlite.serialize();
    expect(await writeAdmin('new-admin')).toEqual({
      ok: true,
      response: { year: 2027, receipt: 'new-admin' },
    });
    expect(await writeAnnual('new-annual')).toEqual({
      ok: true,
      replayed: true,
      response: { year: 2028, receipt: 'new-annual' },
    });
    for (const override of [
      { actorSubject: 'another-actor' },
      { request: { changed: true } },
      { operation: 'different-operation' },
    ]) {
      expect(
        await loadConfigurationReceipt(h.env.DB, { ...adminInput('new-admin'), ...override }),
      ).toEqual({ ok: false, error: 'idempotency_key_reused' });
      expect(
        await replayAnnualPlanMutation(h.env.DB, { ...annualInput('new-annual'), ...override }),
      ).toEqual({ ok: false, error: 'idempotency_key_reused' });
    }
    deepStrictEqual(h.sqlite.serialize(), before);
  });

  it('protects real version Save and Restore receipts while exact replay survives a head advance', async () => {
    const source = await captureBidDefinitionSource(h.env.DB, 2027);
    if (!source.ok) throw new Error(JSON.stringify(source));
    const input: SaveBidDefinitionInput = {
      year: 2027,
      key: 'real-version-save',
      actorSubject: SUBJECT,
      actorId: ACTOR,
      expected: { kind: 'legacy', sourceToken: source.sourceToken },
      reason: 'Synthetic immutable version adoption',
      intent: { operation: 'save', content: source.content },
    };
    const saved = await saveBidDefinition(h.env.DB, input);
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const restore: SaveBidDefinitionInput = {
      ...input,
      key: 'real-version-restore',
      expected: {
        kind: 'version',
        versionId: String(saved.response.versionId),
        revision: 1,
        sha256: String(saved.response.contentSha256),
      },
      intent: { operation: 'restore', versionId: String(saved.response.versionId) },
    };
    const restored = await saveBidDefinition(h.env.DB, restore);
    expect(restored).toMatchObject({
      ok: true,
      replayed: false,
      response: { versionNumber: 2, changed: true, restoredFromId: saved.response.versionId },
    });
    for (const key of [input.key, restore.key]) {
      const attack = receiptInsert(
        'admin_configuration_receipts',
        `replacement-${key}`,
        rowid('admin_configuration_receipts', key),
      );
      rejected(attack.sql, attack.parameters);
    }
    const before = h.sqlite.serialize();
    expect(await saveBidDefinition(h.env.DB, input)).toEqual({ ...saved, replayed: true });
    expect(await saveBidDefinition(h.env.DB, restore)).toEqual({ ...restored, replayed: true });
    expect(
      await saveBidDefinition(h.env.DB, { ...restore, reason: 'Different reviewed reason' }),
    ).toMatchObject({ ok: false, error: 'idempotency_key_reused' });
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});
