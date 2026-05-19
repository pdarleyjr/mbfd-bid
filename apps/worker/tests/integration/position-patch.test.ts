import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'm'.repeat(64);
async function fresh(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'B',
      last_name: 'A',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}
async function stale(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'B',
      last_name: 'A',
      fresh_auth_at: Math.floor(Date.now() / 1000) - 600,
    },
    KEY,
  );
}

describe('PATCH /api/admin/rules/:id', () => {
  let h: TestD1;
  let ruleId: number;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.1', 2026, 'draft');",
    );
    await h.db.run(
      "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
    );
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.1', 'A101', '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
    );
    const idRow = await h.db.run('SELECT id FROM position_rules ORDER BY id DESC LIMIT 1');
    ruleId = (idRow.results[0] as { id: number }).id;
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('updates required_criteria and writes audit override_rule', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rules/${ruleId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${await fresh()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          required_criteria: { rank: ['LT'], credentials: ['Paramedic'], custom: [] },
          reason_code: 'rule_override.fix_misconfig',
          reason: 'A101 should require LT not FF (typo).',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const row = await h.db.run('SELECT required_criteria FROM position_rules WHERE id = ?', [
      ruleId,
    ]);
    const rc = JSON.parse((row.results[0] as { required_criteria: string }).required_criteria);
    expect(rc.rank).toEqual(['LT']);

    const audit = await h.db.run(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'override_rule' AND target_id = ?",
      [String(ruleId)],
    );
    expect(audit.results[0]?.n).toBe(1);
  });

  it('returns 401 step_up_required when fresh_auth_at is older than 300s', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rules/${ruleId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${await stale()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tie_break_chain: ['points', 'rsc_seniority', 'rank_seniority'],
          reason_code: 'rule_override.fix_misconfig',
          reason: 'stale auth attempt',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(401);
  });

  it('rejects malformed required_criteria (400)', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rules/${ruleId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${await fresh()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          required_criteria: { rank: ['SUPREME_LEADER'], credentials: [], custom: [] },
          reason_code: 'rule_override.fix_misconfig',
          reason: 'invalid rank',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });

  it('returns 409 when rule_book is active (must edit drafts only)', async () => {
    await h.db.run("UPDATE rule_books SET status = 'active' WHERE version = '2026.1';");
    const res = await app.fetch(
      new Request(`http://x/api/admin/rules/${ruleId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${await fresh()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tie_break_chain: ['points', 'rsc_seniority', 'rank_seniority'],
          reason_code: 'rule_override.fix_misconfig',
          reason: 'cannot edit active rulebook',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(409);
  });
});
