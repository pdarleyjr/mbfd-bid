import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('guided adoption of an existing designated draft', () => {
  let h: TestD1;
  let token: string;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    token = await signJwt(
      {
        sub: 0,
        emp: 'synthetic-admin',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Admin',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
    h.sqlite.exec(`INSERT INTO position_templates (version,effective_year) VALUES ('2027.1',2027);
      INSERT INTO rule_books (version,effective_year,status,revision) VALUES ('2027.1',2027,'draft',2);
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',3,'{"v":1,"expectedDurationDays":2,"turnTimerSeconds":180}');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('stable-seat','2027.1','A','7','Combat','Engine','FF','Firefighter');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','stable-seat','2027.1','{}','{}','[]');
      INSERT INTO rule_book_position_participation (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
        VALUES ('2027.1','stable-seat','2027.1','BIDDABLE','Synthetic legacy participation',1);`);
  });
  afterEach(async () => teardownTestD1(h));
  const sourceRevision = () =>
    (
      h.sqlite.prepare('SELECT revision FROM annual_source_revision WHERE id=1').get() as {
        revision: number;
      }
    ).revision;
  const body = () => ({
    effective_on: '2027-01-01',
    credential_evaluation_on: '2026-12-01',
    expected_duration_days: 3,
    turn_timer_seconds: 90,
    reason: 'Synthetic reviewed adoption',
    expected_rule_revision: 2,
    expected_configuration_revision: 3,
    expected_source_revision: sourceRevision(),
    accept_existing_draft: true,
  });
  const adopt = (payload = body(), key = 'synthetic-adopt') =>
    app.fetch(
      new Request('http://x/api/admin/annual-plan/2027/adopt', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(payload),
      }),
      h.env,
    );
  it('retains designated identities and rules, requires fresh participation review, and replays the original result', async () => {
    const originalRules = h.sqlite.prepare('SELECT * FROM position_rules').all();
    const proposal = body();
    const response = await adopt(proposal);
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved).toMatchObject({
      ruleBookVersion: '2027.1',
      templateVersion: '2027.1',
      replayed: false,
    });
    expect(h.sqlite.prepare('SELECT * FROM position_rules').all()).toEqual(originalRules);
    expect(
      h.sqlite
        .prepare('SELECT authoritative_source_ref FROM rule_book_position_participation')
        .get(),
    ).toEqual({ authoritative_source_ref: 'inherited-unreviewed:adopted-year:2027' });
    const configured = h.sqlite
      .prepare('SELECT config_json,configuration_revision FROM bid_years WHERE year=2027')
      .get() as { config_json: string; configuration_revision: number };
    expect(JSON.parse(configured.config_json)).toEqual({
      v: 2,
      personnelEvaluationOn: '2027-01-01',
      credentialEvaluationOn: '2026-12-01',
      expectedDurationDays: 3,
      turnTimerSeconds: 90,
    });
    expect(configured.configuration_revision).toBe(4);
    h.sqlite.exec('UPDATE annual_source_revision SET revision=revision+1 WHERE id=1');
    expect(await (await adopt(proposal)).json()).toEqual({ ...(saved as object), replayed: true });
    expect((await adopt({ ...proposal, reason: 'Different intent' })).status).toBe(409);
    expect((await adopt(body(), 'second-adoption')).status).toBe(409);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 1 });
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  it('rolls back dates, participation, receipt and review when the audit fails', async () => {
    h.sqlite.exec(
      "CREATE TRIGGER fail_adoption_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    );
    expect((await adopt()).status).toBe(409);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS count FROM annual_plan_reviews').get()).toEqual({
      count: 0,
    });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS count FROM annual_plan_receipts').get()).toEqual({
      count: 0,
    });
    expect(
      h.sqlite.prepare('SELECT configuration_revision FROM bid_years WHERE year=2027').get(),
    ).toEqual({ configuration_revision: 3 });
    expect(
      h.sqlite
        .prepare('SELECT authoritative_source_ref FROM rule_book_position_participation')
        .get(),
    ).toEqual({ authoritative_source_ref: 'Synthetic legacy participation' });
  });
  it.each(['stale', 'shared-template', 'published', 'real-session'] as const)(
    'rejects %s without an adoption receipt',
    async (caseName) => {
      const proposal = body();
      if (caseName === 'stale')
        h.sqlite.exec('UPDATE annual_source_revision SET revision=revision+1 WHERE id=1');
      if (caseName === 'shared-template')
        h.sqlite.exec(
          "INSERT INTO bid_years (year,status,position_template_version) VALUES (2028,'configuring','2027.1')",
        );
      if (caseName === 'published')
        h.sqlite.exec("UPDATE rule_books SET status='active' WHERE version='2027.1'");
      if (caseName === 'real-session')
        h.sqlite.exec(
          "INSERT INTO bid_sessions (id,bid_year,is_mock,started_at,current_phase) VALUES ('synthetic-real',2027,0,1,'not_started')",
        );
      expect((await adopt(proposal)).status).toBe(409);
      expect(h.sqlite.prepare('SELECT COUNT(*) AS count FROM annual_plan_receipts').get()).toEqual({
        count: 0,
      });
    },
  );
});
