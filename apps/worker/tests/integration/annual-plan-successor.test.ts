import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('reviewed pre-bid successor', () => {
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
    h.sqlite.exec(`INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at) VALUES (0,'synthetic-admin','Synthetic','Admin','CHIEF','FF',1,1,1);
      INSERT INTO position_templates (version,effective_year) VALUES ('2027.1',2027);
      INSERT INTO rule_books (version,effective_year,status,revision) VALUES ('2027.1',2027,'draft',2);
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',3,'{"v":1,"expectedDurationDays":2,"turnTimerSeconds":180}');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('stable-seat','2027.1','A','7','Combat','Engine','FF','Firefighter');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','stable-seat','2027.1','{}','{}','[]');
      INSERT INTO rule_book_position_participation (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
        VALUES ('2027.1','stable-seat','2027.1','BIDDABLE','Synthetic approved participation',1);
      INSERT INTO annual_bid_policy_documents (id,rule_book_version,effective_year,revision,status,policy_text,execution_policy_json,created_at,updated_at)
        VALUES ('approved-policy','2027.1',2027,1,'PUBLISHED','Synthetic approved text','{}',1,1);
      UPDATE bid_years SET annual_policy_document_id='approved-policy' WHERE year=2027;
      UPDATE rule_books SET status='active' WHERE version='2027.1';`);
  });
  afterEach(async () => teardownTestD1(h));
  const body = () => ({
    effective_on: '2027-01-01',
    credential_evaluation_on: '2026-12-01',
    expected_duration_days: 3,
    turn_timer_seconds: 90,
    reason: 'Synthetic adopted amendment requires a new preparation',
    expected_rule_revision: 2,
    expected_configuration_revision: 3,
    expected_source_revision: (
      h.sqlite.prepare('SELECT revision FROM annual_source_revision WHERE id=1').get() as {
        revision: number;
      }
    ).revision,
    accept_successor: true,
  });
  const request = (payload = body(), key = 'synthetic-successor') =>
    app.fetch(
      new Request('http://x/api/admin/annual-plan/2027/successor', {
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
  it('copies every seat and rule, preserves the predecessor and published policy, and replays once', async () => {
    const oldRules = h.sqlite
      .prepare("SELECT * FROM position_rules WHERE rule_book_version='2027.1'")
      .all();
    const oldPolicy = h.sqlite
      .prepare("SELECT * FROM annual_bid_policy_documents WHERE id='approved-policy'")
      .get();
    const proposal = body();
    let batchError = '';
    const batch = h.env.DB.batch.bind(h.env.DB);
    vi.spyOn(h.env.DB, 'batch').mockImplementation(async (statements) => {
      try {
        return await batch(statements);
      } catch (error) {
        batchError = String(error);
        throw error;
      }
    });
    const response = await request(proposal);
    expect(response.status, batchError).toBe(200);
    const result = (await response.json()) as {
      ruleBookVersion: string;
      annualPolicyDocumentId: string;
    };
    expect(
      h.sqlite.prepare("SELECT * FROM position_rules WHERE rule_book_version='2027.1'").all(),
    ).toEqual(oldRules);
    expect(
      h.sqlite
        .prepare("SELECT * FROM annual_bid_policy_documents WHERE id='approved-policy'")
        .get(),
    ).toEqual(oldPolicy);
    expect(
      h.sqlite.prepare('SELECT status FROM rule_books WHERE version=?').get(result.ruleBookVersion),
    ).toEqual({ status: 'draft' });
    expect(
      h.sqlite
        .prepare('SELECT status,supersedes_document_id FROM annual_bid_policy_documents WHERE id=?')
        .get(result.annualPolicyDocumentId),
    ).toEqual({ status: 'DRAFT', supersedes_document_id: 'approved-policy' });
    expect(
      h.sqlite
        .prepare(
          'SELECT position_id,required_criteria FROM position_rules WHERE rule_book_version=?',
        )
        .all(result.ruleBookVersion),
    ).toEqual([{ position_id: 'stable-seat', required_criteria: '{}' }]);
    expect(
      h.sqlite
        .prepare(
          'SELECT authoritative_source_ref FROM rule_book_position_participation WHERE rule_book_version=?',
        )
        .get(result.ruleBookVersion),
    ).toEqual({ authoritative_source_ref: 'inherited-unreviewed:successor:2027.1' });
    expect(await (await request(proposal)).json()).toEqual({ ...result, replayed: true });
    expect((await request({ ...proposal, reason: 'Different intent' })).status).toBe(409);
    expect(h.sqlite.prepare('SELECT count(*) AS n FROM annual_plan_receipts').get()).toEqual({
      n: 1,
    });
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  it.each(['stale', 'real', 'audit'] as const)(
    'rejects %s without partial copies or changing the approved setup',
    async (failure) => {
      const proposal = body();
      if (failure === 'stale')
        h.sqlite.exec('UPDATE annual_source_revision SET revision=revision+1');
      if (failure === 'real')
        h.sqlite.exec(
          "INSERT INTO bid_sessions (id,bid_year,is_mock,started_at,current_phase) VALUES ('real-test',2027,0,1,'not_started')",
        );
      if (failure === 'audit')
        h.sqlite.exec(
          "CREATE TRIGGER fail_successor BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
        );
      expect((await request(proposal)).status).toBe(409);
      expect(h.sqlite.prepare('SELECT count(*) AS n FROM annual_plan_receipts').get()).toEqual({
        n: 0,
      });
      expect(h.sqlite.prepare('SELECT count(*) AS n FROM rule_books').get()).toEqual({ n: 1 });
      expect(
        h.sqlite
          .prepare('SELECT rule_book_version,configuration_revision FROM bid_years WHERE year=2027')
          .get(),
      ).toEqual({ rule_book_version: '2027.1', configuration_revision: 3 });
    },
  );
});
