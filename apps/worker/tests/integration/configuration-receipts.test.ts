import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';
describe('reviewed rule mutation receipts', () => {
  let h: TestD1;
  let token: string;
  const sign = (id: number) =>
    signJwt(
      {
        sub: id,
        emp: `synthetic-${id}`,
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Admin',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
  const patch = {
    expected_rule_book_revision: 0,
    notes: 'Synthetic reviewed rule',
    reason_code: 'rule_override.fix_misconfig',
    reason: 'Synthetic rule receipt verification',
  };
  const request = (body: unknown, key: string, authorization = token, method = 'PATCH') =>
    app.fetch(
      new Request('http://x/api/admin/rules/1', {
        method,
        headers: {
          Authorization: `Bearer ${authorization}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(body),
      }),
      h.env,
    );
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
    INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at) VALUES (100,'synthetic-100','Synthetic','Admin','FF','FF',100,0,1,1),(101,'synthetic-101','Synthetic','Second','FF','FF',101,0,1,1);
    INSERT INTO position_templates (version,effective_year) VALUES ('synthetic-2027',2027);
    INSERT INTO rule_books (version,effective_year,status) VALUES ('synthetic-2027',2027,'draft');
    INSERT INTO positions (id,template_version,division,shift,station,unit,rank_required,position_name) VALUES ('A-1','synthetic-2027','Combat','A','1','Engine','FF','Firefighter');
    INSERT INTO position_rules (id,rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain) VALUES (1,'synthetic-2027','A-1','synthetic-2027','{"rank":["FF"],"credentials":[],"custom":[]}','{"max":0,"items":[]}','["rsc_seniority"]');
  `);
    token = await sign(100);
  });
  afterEach(async () => teardownTestD1(h));
  it('replays a lost response without a second revision or audit and binds the key to actor and exact intent', async () => {
    const first = await request(patch, 'same');
    expect(first.status).toBe(200);
    const saved = await first.json();
    expect(await (await request(patch, 'same')).json()).toEqual({
      ...(saved as object),
      replayed: true,
    });
    expect(h.sqlite.prepare('SELECT revision FROM rule_books').get()).toEqual({ revision: 1 });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 1 });
    expect((await request({ ...patch, notes: 'Different intent' }, 'same')).status).toBe(409);
    expect((await request(patch, 'same', await sign(101))).status).toBe(409);
    expect((await request(patch, 'stale')).status).toBe(409);
  });
  it('rolls rule, revision and audit back if the receipt cannot persist', async () => {
    h.failNextBatchAt(3);
    expect((await request(patch, 'retry')).status).toBe(409);
    expect(h.sqlite.prepare('SELECT revision FROM rule_books').get()).toEqual({ revision: 0 });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 0 });
    expect((await request(patch, 'retry')).status).toBe(200);
    expect(() => h.sqlite.prepare('DELETE FROM admin_configuration_receipts').run()).toThrow(
      /immutable/,
    );
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  it('replays a deleted draft rule from its receipt and rejects stale or different actors', async () => {
    const { notes: _notes, ...body } = patch;
    const first = await request(body, 'delete', token, 'DELETE');
    expect(first.status).toBe(200);
    const saved = await first.json();
    expect(await (await request(body, 'delete', token, 'DELETE')).json()).toEqual({
      ...(saved as object),
      replayed: true,
    });
    expect((await request(body, 'delete', await sign(101), 'DELETE')).status).toBe(409);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM position_rules').get()).toEqual({ n: 0 });
    expect(h.sqlite.prepare('SELECT revision FROM rule_books').get()).toEqual({ revision: 1 });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 1 });
  });
  it('rolls a deletion back when its receipt fails and rejects stale reviewed revisions', async () => {
    const { notes: _notes, ...body } = patch;
    h.failNextBatchAt(3);
    expect((await request(body, 'delete-retry', token, 'DELETE')).status).toBe(409);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM position_rules').get()).toEqual({ n: 1 });
    expect(h.sqlite.prepare('SELECT revision FROM rule_books').get()).toEqual({ revision: 0 });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 0 });
    expect(
      (await request({ ...body, expected_rule_book_revision: 1 }, 'stale-delete', token, 'DELETE'))
        .status,
    ).toBe(409);
    expect((await request(body, 'delete-retry', token, 'DELETE')).status).toBe(200);
  });
});
