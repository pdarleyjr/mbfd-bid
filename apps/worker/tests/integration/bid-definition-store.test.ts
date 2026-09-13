import { deepStrictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import {
  type SaveBidDefinitionInput,
  saveBidDefinition,
} from '../../src/lib/bid-definition-store.js';
import {
  loadBidDefinitionHead,
  loadBidDefinitionVersion,
} from '../../src/lib/bid-definition-version.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('atomic Bid version editing store', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
        VALUES (10001,'synthetic-version-editor','Synthetic','Editor','FF','FF',1,1,1);
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic topology');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',4,'Synthetic source');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',3,'{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-01"}');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('synthetic-seat','2027.1','A','7','Combat','Engine 7','FF','Firefighter');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain,notes)
        VALUES ('2027.1','synthetic-seat','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}',
          '{"max":7,"items":[{"credential":"B","points":5},{"credential":"A","points":4}]}','["points","rsc_seniority"]','Advanced scoring order');
      INSERT INTO rule_book_position_participation (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
        VALUES ('2027.1','synthetic-seat','2027.1','BIDDABLE','synthetic:participation',1);
      INSERT INTO staffing_positions (id,stable_slot_key,review_status,created_at,updated_at) VALUES ('synthetic-staffing','synthetic-staffing','approved',1,1);
      INSERT INTO position_staffing_bindings (position_id,template_version,staffing_position_id,authoritative_source_ref,review_status,created_at)
        VALUES ('synthetic-seat','2027.1','synthetic-staffing','synthetic:binding','approved',1);
    `);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  async function initial(key = 'synthetic-save-1'): Promise<SaveBidDefinitionInput> {
    const captured = await captureBidDefinitionSource(h.env.DB, 2027);
    if (!captured.ok) throw new Error(JSON.stringify(captured));
    return {
      year: 2027,
      key,
      actorSubject: 'synthetic-editor',
      actorId: 10001,
      expected: { kind: 'legacy', sourceToken: captured.sourceToken },
      reason: 'Synthetic version adoption',
      intent: { operation: 'save', content: captured.content },
    };
  }
  async function currentInput(key: string): Promise<SaveBidDefinitionInput> {
    const head = await loadBidDefinitionHead(h.env.DB, 2027);
    if (!head) throw new Error('Missing test head');
    const version = await loadBidDefinitionVersion(h.env.DB, 2027, head.versionId);
    if (!version.ok) throw new Error(JSON.stringify(version));
    return {
      year: 2027,
      key,
      actorSubject: 'synthetic-editor',
      actorId: 10001,
      expected: {
        kind: 'version',
        versionId: head.versionId,
        revision: head.revision,
        sha256: version.sha256,
      },
      reason: 'Synthetic content save',
      intent: { operation: 'save', content: version.content },
    };
  }
  function counts() {
    return Object.fromEntries(
      [
        'bid_definition_versions',
        'bid_definition_heads',
        'position_templates',
        'rule_books',
        'positions',
        'position_rules',
        'rule_book_position_participation',
        'position_staffing_bindings',
        'annual_bid_policy_documents',
        'admin_configuration_receipts',
        'audit_log',
      ].map((name) => [name, h.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get()]),
    );
  }
  async function save(input: SaveBidDefinitionInput) {
    const result = await saveBidDefinition(h.env.DB, input);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result;
  }

  it('adopts complete material into private aliases without retargeting the year or losing advanced rules', async () => {
    const before = h.sqlite.prepare('SELECT * FROM bid_years').all();
    const input = await initial();
    const result = await save(input);
    expect(result.response).toMatchObject({ changed: true, versionNumber: 1, predecessorId: null });
    const version = await loadBidDefinitionVersion(
      h.env.DB,
      2027,
      String(result.response.versionId),
    );
    expect(version.ok).toBe(true);
    if (!version.ok) throw new Error(JSON.stringify(version));
    expect(version.row.rule_book_version).toBe('2027.2');
    expect(version.row.rule_book_revision).toBe(0);
    expect(version.content).toEqual(
      input.intent.operation === 'save' ? input.intent.content : null,
    );
    expect(h.sqlite.prepare('SELECT * FROM bid_years').all()).toEqual(before);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('records no-op receipts without creating material, and replays them after a later head advance', async () => {
    await save(await initial());
    const noOp = await currentInput('synthetic-no-op');
    const before = counts();
    const response = await save(noOp);
    expect(response.response.changed).toBe(false);
    const after = counts();
    for (const table of Object.keys(before).filter(
      (name) => !['admin_configuration_receipts', 'audit_log'].includes(name),
    ))
      expect(after[table]).toEqual(before[table]);
    const next = await currentInput('synthetic-change');
    if (next.intent.operation !== 'save') throw new Error('Bad fixture');
    next.intent.content = {
      ...(next.intent.content as Record<string, unknown>),
      notes: { bid: 'Changed source language', positions: 'Synthetic topology' },
    };
    await save(next);
    const bytes = h.sqlite.serialize();
    expect(await save(noOp)).toEqual({ ...response, replayed: true });
    deepStrictEqual(h.sqlite.serialize(), bytes);
    expect(await saveBidDefinition(h.env.DB, { ...noOp, key: 'new-stale-key' })).toMatchObject({
      ok: false,
      error: 'bid_definition_or_source_changed',
    });
  });

  it('restores to a new identity even when the selected content is identical', async () => {
    const first = await save(await initial());
    const restore = await currentInput('synthetic-restore');
    restore.intent = { operation: 'restore', versionId: String(first.response.versionId) };
    const second = await save(restore);
    expect(second.response).toMatchObject({
      changed: true,
      versionNumber: 2,
      restoredFromId: first.response.versionId,
      contentSha256: first.response.contentSha256,
    });
    expect(second.response.versionId).not.toBe(first.response.versionId);
    expect(await save(restore)).toEqual({ ...second, replayed: true });
    expect((await save(await currentInput('no-op-after-restore'))).response).toMatchObject({
      changed: false,
      versionId: second.response.versionId,
      restoredFromId: first.response.versionId,
    });
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('allows one of two parallel saves and leaves exactly one complete version', async () => {
    const input = await initial();
    const results = await Promise.all([
      saveBidDefinition(h.env.DB, input),
      saveBidDefinition(h.env.DB, { ...input, key: 'competing-save' }),
    ]);
    expect(results.filter((entry) => entry.ok)).toHaveLength(1);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_definition_versions').get()).toEqual({
      n: 1,
    });
    expect(
      h.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_configuration_receipts').get(),
    ).toEqual({ n: 1 });
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('resolves a committed lost response by its receipt without a second write', async () => {
    const input = await initial();
    const batch = h.env.DB.batch.bind(h.env.DB);
    vi.spyOn(h.env.DB, 'batch').mockImplementationOnce(async (statements) => {
      await batch(statements);
      throw new Error('Synthetic lost response after commit');
    });
    const result = await save(input);
    expect(result.replayed).toBe(true);
    const bytes = h.sqlite.serialize();
    expect(await save(input)).toEqual(result);
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it.each(Array.from({ length: 10 }, (_, i) => i))(
    'rolls back every byte when batch statement %i fails',
    async (index) => {
      const input = await initial();
      const bytes = h.sqlite.serialize();
      h.failNextBatchAt(index);
      expect(await saveBidDefinition(h.env.DB, input)).toMatchObject({ ok: false });
      deepStrictEqual(h.sqlite.serialize(), bytes);
      expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    },
  );

  it.each(['notes', 'source-revision', 'head'])(
    'rejects %s drift inside the batch before reserving a receipt',
    async (kind) => {
      const input = await initial();
      const batch = h.env.DB.batch.bind(h.env.DB);
      let before: Buffer | undefined;
      vi.spyOn(h.env.DB, 'batch').mockImplementationOnce(async (statements) => {
        if (kind === 'notes')
          h.sqlite.exec(
            "UPDATE position_templates SET notes='Concurrent notes' WHERE version='2027.1'",
          );
        if (kind === 'source-revision')
          h.sqlite.exec('UPDATE annual_source_revision SET revision=revision+1 WHERE id=1');
        if (kind === 'head') {
          const winner = { ...input, key: 'concurrent-winner' };
          await save(winner);
        }
        before = h.sqlite.serialize();
        return batch(statements);
      });
      expect(await saveBidDefinition(h.env.DB, input)).toMatchObject({
        ok: false,
        error: 'bid_definition_or_source_changed',
      });
      if (!before) throw new Error('Synthetic batch did not execute');
      deepStrictEqual(h.sqlite.serialize(), before);
    },
  );

  it('rejects key reuse across actor, operation or semantic material', async () => {
    const input = await initial();
    await save(input);
    for (const changed of [
      { ...input, actorSubject: 'other-editor' },
      { ...input, reason: 'Another reason' },
      { ...input, intent: { operation: 'restore' as const, versionId: 'unknown' } },
    ])
      expect(await saveBidDefinition(h.env.DB, changed)).toMatchObject({
        ok: false,
        error: 'idempotency_key_reused',
      });
  });

  it('loads old versions by their own material after later saves and rejects corruption', async () => {
    const first = await save(await initial());
    const next = await currentInput('next-version');
    next.intent = { operation: 'restore', versionId: String(first.response.versionId) };
    await save(next);
    const old = await loadBidDefinitionVersion(h.env.DB, 2027, String(first.response.versionId));
    expect(old.ok).toBe(true);
    // Isolated corruption simulation: remove only the relevant content guard.
    h.sqlite.exec('DROP TRIGGER bid_version_positions_update');
    h.sqlite
      .prepare('UPDATE positions SET position_name=? WHERE template_version=?')
      .run('Corrupt fixture', '2027.2');
    expect(
      await loadBidDefinitionVersion(h.env.DB, 2027, String(first.response.versionId)),
    ).toMatchObject({ ok: false, error: 'bid_version_integrity_failed' });
    expect((await currentInput('still-valid')).expected).toMatchObject({
      kind: 'version',
      revision: 2,
    });
  });
});
