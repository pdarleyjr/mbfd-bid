import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'j'.repeat(64);
async function adminJwt(): Promise<string> {
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

async function seedRulebookAndMember(h: TestD1) {
  const now = Date.now();
  await h.db.run(
    "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (80, '80080', 'Eligi', 'Test', 'LT', 'OFC', 50, 0, ?, ?);",
    [now, now],
  );
  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
  );
  await h.db.run(
    "INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name) VALUES ('A205', '2026.1', 'A', '2', 'Rescue', 'Rescue 2', 'LT', 'Rescue 2 LT');",
  );
  await h.db.run(
    "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.1', 2026, 'active');",
  );
  await h.db.run(
    `INSERT INTO position_rules
     (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
     VALUES ('2026.1', 'A205', '2026.1',
       '{"rank":["LT"],"credentials":[],"custom":["paramedic"]}',
       '{"max":0,"items":[]}',
       '["points","rsc_seniority","rank_seniority"]');`,
  );
}

describe('POST /api/admin/eligibility/preview', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    await seedRulebookAndMember(h);
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('returns eligible=false with PARAMEDIC_REQUIRED for member missing Paramedic cert', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/eligibility/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 80,
          position_id: 'A205',
          rule_book_version: '2026.1',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { eligible: boolean; reasons: { code: string }[] };
    expect(body.eligible).toBe(false);
    expect(body.reasons.some((r) => r.code === 'PARAMEDIC_REQUIRED')).toBe(true);
  });

  it('returns eligible=true after granting Paramedic cert', async () => {
    await h.db.run("INSERT INTO credentials (id, name) VALUES (1, 'Paramedic');");
    await h.db.run('INSERT INTO member_credentials (member_id, credential_id) VALUES (80, 1);');
    const res = await app.fetch(
      new Request('http://x/api/admin/eligibility/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 80,
          position_id: 'A205',
          rule_book_version: '2026.1',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const body = (await res.json()) as { eligible: boolean };
    expect(body.eligible).toBe(true);
  });

  it('uses effective-dated qualification evidence instead of a timeless legacy credential row', async () => {
    await h.db.run("INSERT INTO credentials (id, name) VALUES (1, 'Paramedic');");
    await h.db.run(
      "INSERT INTO member_credentials (member_id, credential_id, start_date, expiration_date) VALUES (80, 1, '2026-10-01', '2026-12-31');",
    );
    const requestAt = async (asOf: string) =>
      app.fetch(
        new Request('http://x/api/admin/eligibility/preview', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await adminJwt()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            member_id: 80,
            position_id: 'A205',
            rule_book_version: '2026.1',
            as_of: asOf,
          }),
        }),
        { ...h.env, JWT_SIGNING_KEY: KEY },
      );

    const beforeStart = await requestAt('2026-09-30');
    expect(beforeStart.status).toBe(200);
    await expect(beforeStart.json()).resolves.toMatchObject({ eligible: false });

    const whileActive = await requestAt('2026-10-02');
    expect(whileActive.status).toBe(200);
    await expect(whileActive.json()).resolves.toMatchObject({ eligible: true });

    await h.db.run(
      `INSERT INTO member_qualification_events
         (id, member_id, credential_id, specialty_code, kind, effective_on, expires_on,
          evidence_source, evidence_reference, reason, actor_subject, idempotency_key,
          before_state, after_state, created_at)
       VALUES ('preview-paramedic-revocation', 80, 1, NULL, 'CERTIFICATION_REVOKED', '2026-11-01', NULL,
        'synthetic-state-registry', 'SYNTH-PREVIEW-REVOKE', 'Synthetic revocation evidence.', '0',
        'preview-paramedic-revocation', '{}', '{}', 1);`,
    );
    const afterRevocation = await requestAt('2026-11-02');
    expect(afterRevocation.status).toBe(200);
    await expect(afterRevocation.json()).resolves.toMatchObject({ eligible: false });
  });

  it('uses the specified rule_book_version when provided', async () => {
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.2', 2026, 'draft');",
    );
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.2', 'A205', '2026.1',
         '{"rank":["LT"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
    );
    const res = await app.fetch(
      new Request('http://x/api/admin/eligibility/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member_id: 80, position_id: 'A205', rule_book_version: '2026.2' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const body = (await res.json()) as { eligible: boolean };
    expect(body.eligible).toBe(true);
  });

  it('requires an explicit version even when exactly one annual book is active', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/eligibility/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member_id: 80, position_id: 'A205' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'rule_book_version_required',
      rule_book_version_required: true,
      configuration_required: true,
    });
  });

  it('blocks a preview when another rule in the selected book is invalid', async () => {
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.1', 'B101', '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":["pre_bid_pool"]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
    );

    const res = await app.fetch(
      new Request('http://x/api/admin/eligibility/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 80,
          position_id: 'A205',
          rule_book_version: '2026.1',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'rule_book_invalid',
      invalid_position_ids: ['B101'],
    });
  });

  it('does not award Technician points when the all-six Operations gate is incomplete', async () => {
    const operations = [
      'Hazardous Materials Operations',
      'Rope Rescue Operations',
      'Confined Space Operations',
      'Structural Collapse Operations',
      'Trench Rescue Operations',
      'Vehicle & Machinery Rescue Operations',
    ];
    const held = [
      'Rope Rescue Technician',
      ...operations.filter((name) => name !== 'Trench Rescue Operations'),
    ];
    for (const [index, name] of held.entries()) {
      await h.db.run('INSERT INTO credentials (id, name) VALUES (?, ?);', [index + 1, name]);
      await h.db.run('INSERT INTO member_credentials (member_id, credential_id) VALUES (80, ?);', [
        index + 1,
      ]);
    }
    await h.db.run(
      `UPDATE position_rules
       SET points_preference = '{"max":2,"items":[{"points":2,"credential":"Rope Rescue Technician","gating":"ops_all_6"}]}'
       WHERE position_id = 'A205' AND rule_book_version = '2026.1';`,
    );

    const res = await app.fetch(
      new Request('http://x/api/admin/eligibility/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 80,
          position_id: 'A205',
          rule_book_version: '2026.1',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { points: number };
    expect(body.points).toBe(0);
  });

  it('requires an explicit version before inspecting active rule-book state', async () => {
    await h.db.run("UPDATE rule_books SET status = 'archived' WHERE version = '2026.1';");
    const res = await app.fetch(
      new Request('http://x/api/admin/eligibility/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member_id: 80, position_id: 'A205' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'rule_book_version_required',
      rule_book_version_required: true,
      configuration_required: true,
    });
  });
});
