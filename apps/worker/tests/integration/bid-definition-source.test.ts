import { deepStrictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('authoritative Bid definition source capture', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic topology');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',2,'Synthetic source');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',3,'{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-01"}');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('stable-seat','2027.1','A','7','Combat','Engine 7','FF','Firefighter');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain,notes)
        VALUES ('2027.1','stable-seat','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}','{"max":0,"items":[]}','["rsc_seniority"]','Direct advanced rule');
    `);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  it('captures complete canonical material without changing database bytes or requiring Department membership', async () => {
    const before = h.sqlite.serialize();
    const result = await captureBidDefinitionSource(h.env.DB, 2027);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.content).toMatchObject({
      bidYear: 2027,
      notes: { bid: 'Synthetic source', positions: 'Synthetic topology' },
      authoring: null,
      planning: null,
      policy: null,
      participation: [],
      staffingBindings: [],
      rules: [{ positionId: 'stable-seat', notes: 'Direct advanced rule' }],
    });
    expect(result.origin).toMatchObject({
      ruleBookVersion: '2027.1',
      positionTemplateVersion: '2027.1',
      ruleBookRevision: 2,
      configurationRevision: 3,
    });
    expect(result.coverage.valid).toBe(true);
    deepStrictEqual(h.sqlite.serialize(), before);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['orphan', 'duplicate', 'foreign-template', 'unsupported-custom'])(
    'reports %s material without hiding it in a join',
    async (kind) => {
      if (kind === 'orphan') h.sqlite.exec("UPDATE position_rules SET position_id='missing'");
      if (kind === 'duplicate')
        h.sqlite.exec(
          'INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain) SELECT rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain FROM position_rules',
        );
      if (kind === 'foreign-template')
        h.sqlite.exec("UPDATE position_rules SET template_version='2027.999'");
      if (kind === 'unsupported-custom')
        h.sqlite.exec(
          `UPDATE position_rules SET required_criteria='{"rank":["FF"],"credentials":[],"custom":["pre_bid_pool"]}'`,
        );
      const before = h.sqlite.serialize();
      const result = await captureBidDefinitionSource(h.env.DB, 2027);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Invalid legacy material was accepted');
      expect(result.error).toBe('bid_definition_source_invalid');
      deepStrictEqual(h.sqlite.serialize(), before);
    },
  );

  it('preserves absent participation versus explicit sourced BIDDABLE', async () => {
    const absent = await captureBidDefinitionSource(h.env.DB, 2027);
    h.sqlite.exec(`INSERT INTO rule_book_position_participation
      (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
      VALUES ('2027.1','stable-seat','2027.1','BIDDABLE','Synthetic reviewed participation',1)`);
    const explicit = await captureBidDefinitionSource(h.env.DB, 2027);
    if (!absent.ok || !explicit.ok) throw new Error('Valid source rejected');
    expect(explicit.sha256).not.toBe(absent.sha256);
    expect(explicit.coverage.expectedBiddablePositionIds).toEqual(
      absent.coverage.expectedBiddablePositionIds,
    );
  });

  it('rejects source drift during capture', async () => {
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    let changed = false;
    vi.spyOn(h.env.DB, 'prepare').mockImplementation((sql) => {
      if (!changed && sql.includes('FROM position_rules')) {
        changed = true;
        h.sqlite.exec("UPDATE positions SET position_name='Concurrent source change'");
      }
      return prepare(sql);
    });
    expect(await captureBidDefinitionSource(h.env.DB, 2027)).toMatchObject({
      ok: false,
      error: 'bid_definition_source_changed',
    });
  });

  it('identifies missing and unconfigured years without generating defaults', async () => {
    expect(await captureBidDefinitionSource(h.env.DB, 2028)).toMatchObject({
      ok: false,
      error: 'bid_year_not_found',
    });
    h.sqlite.exec("INSERT INTO bid_years (year,status) VALUES (2028,'configuring')");
    const result = await captureBidDefinitionSource(h.env.DB, 2028);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Empty editable year rejected');
    expect(result.content.settings).toBeNull();
    expect(result.content.positions).toEqual([]);
    expect(result.content.rules).toEqual([]);
    expect(result.coverage.valid).toBe(false);
  });
});
