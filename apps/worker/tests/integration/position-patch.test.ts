import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
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

describe('PATCH and DELETE /api/admin/rules/:id', () => {
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
      `INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
       VALUES ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Firefighter');`,
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
    const book = await h.db.run("SELECT revision FROM rule_books WHERE version = '2026.1';");
    expect(book.results[0]?.revision).toBe(1);

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

  it('accepts an explicit all-operations points gate for a draft rule', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rules/${ruleId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${await fresh()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points_preference: {
            max: 2,
            items: [
              {
                points: 2,
                credential: 'Rope Rescue Technician',
                opsGate: 'all_operations',
              },
            ],
          },
          reason_code: 'rule_override.fix_misconfig',
          reason: 'Model the all six Operations gate explicitly.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(200);
    const row = await h.db.run('SELECT points_preference FROM position_rules WHERE id = ?', [
      ruleId,
    ]);
    const points = JSON.parse((row.results[0] as { points_preference: string }).points_preference);
    expect(points.items[0].opsGate).toBe('all_operations');
  });

  it('canonicalizes the legacy all-six Operations gate instead of silently dropping it', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rules/${ruleId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${await fresh()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points_preference: {
            max: 2,
            items: [
              {
                points: 2,
                credential: 'Rope Rescue Technician',
                gating: 'ops_all_6',
              },
            ],
          },
          reason_code: 'rule_override.fix_misconfig',
          reason: 'Preserve the source all-six Operations requirement.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(200);
    const row = await h.db.run('SELECT points_preference FROM position_rules WHERE id = ?', [
      ruleId,
    ]);
    const points = JSON.parse((row.results[0] as { points_preference: string }).points_preference);
    expect(points.items[0]).toMatchObject({ opsGate: 'all_operations' });
    expect(points.items[0]).not.toHaveProperty('gating');
  });

  it('rejects an unrecognized explicit points gate', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rules/${ruleId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${await fresh()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points_preference: {
            max: 2,
            items: [{ points: 2, credential: 'Rope Rescue Technician', opsGate: 'maybe' }],
          },
          reason_code: 'rule_override.fix_misconfig',
          reason: 'Reject an invented policy gate.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(400);
  });

  it('rejects a schema-valid patch when its persisted form fails the decoder', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rules/${ruleId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${await fresh()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points_preference: {
            max: 2,
            items: [{ points: 2, credential: ' ', gating: 'ops_all_6' }],
          },
          reason_code: 'rule_override.fix_misconfig',
          reason: 'Reject an empty credential after normalization.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'rule_invalid' });
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

  it('deletes a draft rule, increments the draft revision, and records the override audit', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/rules/${ruleId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${await fresh()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason_code: 'rule_override.fix_misconfig',
          reason: 'Remove an accidental duplicate draft rule.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      deleted: true,
      id: ruleId,
      rule_book_version: '2026.1',
      position_id: 'A101',
      revision: 1,
    });
    const rows = await h.db.run('SELECT id FROM position_rules WHERE id = ?', [ruleId]);
    expect(rows.results).toEqual([]);
    const audit = await h.db.run(
      "SELECT action, target_id FROM audit_log WHERE action = 'override_rule' AND target_id = ?",
      [String(ruleId)],
    );
    expect(audit.results).toEqual([{ action: 'override_rule', target_id: String(ruleId) }]);
  });

  it('refuses to delete an active-book rule and leaves its data unchanged', async () => {
    await h.db.run("UPDATE rule_books SET status = 'active' WHERE version = '2026.1';");
    const res = await app.fetch(
      new Request(`http://x/api/admin/rules/${ruleId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${await fresh()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason_code: 'rule_override.policy_direction',
          reason: 'Active rule books are immutable.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'rule_book_immutable', status: 'active' });
    const rows = await h.db.run('SELECT id FROM position_rules WHERE id = ?', [ruleId]);
    expect(rows.results).toHaveLength(1);
    const book = await h.db.run("SELECT revision FROM rule_books WHERE version = '2026.1';");
    expect(book.results[0]?.revision).toBe(0);
  });
});
