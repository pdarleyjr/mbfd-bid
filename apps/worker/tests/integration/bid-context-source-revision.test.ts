import { deepStrictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareBidDefinitionRun } from '../../src/lib/bid-definition-run.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const ADVERSE = ['CONFLICT', 'EXPIRATION_REVIEW', 'REVOCATION_REVIEW'] as const;

describe('pending credential dispute identity invalidation', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,
        is_probationary,employment_status,employment_status_effective_on,created_at,updated_at)
      VALUES (10001,'synthetic-dispute-one','Synthetic','First','FF','FF',1,0,'active','2020-01-01',1,1),
        (10002,'synthetic-dispute-two','Synthetic','Second','FF','FF',2,0,'active','2020-01-01',1,1);
      INSERT INTO credentials (id,name)
        VALUES (7001,'Synthetic irrelevant credential'),(7002,'Synthetic required credential');
      INSERT INTO targetsolutions_imports
        (id,filename,observed_on,source_row_count,unique_row_count,coverage_json,status,created_by,created_at)
        VALUES ('synthetic-context-import','synthetic.csv','2027-01-01',1,1,'{}','reviewed','synthetic-editor',1);
      INSERT INTO targetsolutions_rows
        (id,import_id,row_number,source_json,member_id,credential_id,classification)
        VALUES ('synthetic-context-row','synthetic-context-import',1,
          '{"employeeId":"synthetic-dispute-one","sourceName":"Synthetic irrelevant credential","expiresOn":"2026-12-31"}',
          10001,7001,'NOT_REVIEWED');
    `);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    await teardownTestD1(h);
  });

  function revision(): number {
    const row = h.sqlite
      .prepare('SELECT revision FROM annual_source_revision WHERE id=1')
      .get() as {
      revision: number;
    };
    return row.revision;
  }

  function classify(classification: string) {
    h.sqlite
      .prepare('UPDATE targetsolutions_rows SET classification=? WHERE id=?')
      .run(classification, 'synthetic-context-row');
  }

  function changesRevisionBy(delta: number, statement: string) {
    const before = revision();
    h.sqlite.exec(statement);
    expect(revision()).toBe(before + delta);
  }

  it.each(ADVERSE)(
    'invalidates actual pending %s identity moves exactly once, including null mappings',
    (classification) => {
      classify(classification);
      changesRevisionBy(
        0,
        `UPDATE targetsolutions_rows
      SET member_id=member_id,credential_id=credential_id,classification=classification,reviewed_at=2`,
      );
      changesRevisionBy(1, 'UPDATE targetsolutions_rows SET member_id=10002');
      changesRevisionBy(1, 'UPDATE targetsolutions_rows SET credential_id=7002');
      changesRevisionBy(1, 'UPDATE targetsolutions_rows SET member_id=10001,credential_id=7001');
      changesRevisionBy(1, 'UPDATE targetsolutions_rows SET member_id=NULL');
      changesRevisionBy(0, 'UPDATE targetsolutions_rows SET member_id=NULL');
      changesRevisionBy(1, 'UPDATE targetsolutions_rows SET member_id=10001');
      changesRevisionBy(1, 'UPDATE targetsolutions_rows SET credential_id=NULL');
      changesRevisionBy(0, 'UPDATE targetsolutions_rows SET credential_id=NULL');
      changesRevisionBy(1, 'UPDATE targetsolutions_rows SET credential_id=7001');
    },
  );

  it.each(['NOT_REVIEWED', 'UNCHANGED', 'REFERENCE_ONLY', 'NEW_QUALIFICATION', 'REJECTED'])(
    'does not invalidate a %s observation on identity-only changes',
    (classification) => {
      classify(classification);
      changesRevisionBy(0, 'UPDATE targetsolutions_rows SET member_id=10002,credential_id=7002');
      changesRevisionBy(0, 'UPDATE targetsolutions_rows SET member_id=NULL,credential_id=NULL');
      changesRevisionBy(0, 'UPDATE targetsolutions_rows SET member_id=10001,credential_id=7001');
    },
  );

  it.each([
    ['NOT_REVIEWED', 'CONFLICT'],
    ['CONFLICT', 'UNCHANGED'],
    ['CONFLICT', 'EXPIRATION_REVIEW'],
    ['EXPIRATION_REVIEW', 'REVOCATION_REVIEW'],
  ])('keeps the existing single increment for %s → %s combined with a remap', (before, after) => {
    if (before === undefined || after === undefined)
      throw new Error('Synthetic transition required');
    classify(before);
    const current = revision();
    h.sqlite
      .prepare(
        'UPDATE targetsolutions_rows SET member_id=10002,credential_id=7002,classification=?',
      )
      .run(after);
    expect(revision()).toBe(current + 1);
  });

  it.each(ADVERSE)(
    'preserves the existing %s resolution increment and applied-evidence immutability',
    (classification) => {
      classify(classification);
      changesRevisionBy(
        1,
        `UPDATE targetsolutions_rows
      SET member_id=10002,credential_id=7002,applied_at=2,applied_by='synthetic-reviewer'`,
      );
      const bytes = h.sqlite.serialize();
      expect(() => h.sqlite.exec('UPDATE targetsolutions_rows SET member_id=10001')).toThrow(
        'applied credential import evidence is immutable',
      );
      deepStrictEqual(h.sqlite.serialize(), bytes);
    },
  );

  it('rolls back the source revision together with an interrupted pending remap', () => {
    classify('CONFLICT');
    const bytes = h.sqlite.serialize();
    expect(() =>
      h.sqlite.transaction(() => {
        changesRevisionBy(1, 'UPDATE targetsolutions_rows SET credential_id=7002');
        throw new Error('Synthetic interrupted remap');
      })(),
    ).toThrow('Synthetic interrupted remap');
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it('rejects a real preparation race after the dispute read and blocks the newly relevant dispute on retry', async () => {
    h.sqlite.exec(`
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic dispute topology');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',4,'Synthetic dispute policy');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',3,'{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-01","personnelEvaluationOn":"2027-01-01"}');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('synthetic-context-seat','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic firefighter');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','synthetic-context-seat','2027.1',
          '{"rank":["FF"],"credentials":["Synthetic required credential"],"custom":[]}',
          '{"max":0,"items":[]}','["rsc_seniority"]');
      INSERT INTO member_credentials (member_id,credential_id,start_date,expiration_date)
        VALUES (10001,7002,'2020-01-01',NULL);
    `);
    classify('CONFLICT');
    const captured = await captureBidDefinitionSource(h.env.DB, 2027);
    if (!captured.ok) throw new Error(JSON.stringify(captured));
    const saved = await saveBidDefinition(h.env.DB, {
      year: 2027,
      key: 'synthetic-context-save',
      actorSubject: 'synthetic-editor',
      actorId: 10001,
      expected: { kind: 'legacy', sourceToken: captured.sourceToken },
      reason: 'Synthetic saved policy for dispute race',
      intent: { operation: 'save', content: captured.content },
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const input = {
      year: 2027,
      versionId: String(saved.response.versionId),
      versionSha256: String(saved.response.contentSha256),
      bidSessionId: 'synthetic-context-session',
      capturedAtMs: Date.parse('2027-01-02T12:00:00.000Z'),
      mode: 'mock' as const,
    };
    const before = h.sqlite.serialize();
    const initial = await prepareBidDefinitionRun(h.env.DB, input);
    expect(initial.ok, JSON.stringify(initial)).toBe(true);
    deepStrictEqual(h.sqlite.serialize(), before);

    let remapped = false;
    let afterConcurrentWrite: Buffer | undefined;
    const beforeRaceRevision = revision();
    const originalPrepare = h.env.DB.prepare.bind(h.env.DB);
    vi.spyOn(h.env.DB, 'prepare').mockImplementation((sql) => {
      const statement = originalPrepare(sql);
      if (!remapped && sql.includes('FROM targetsolutions_rows r')) {
        const originalAll = statement.all.bind(statement);
        vi.spyOn(statement, 'all').mockImplementation(async <T>() => {
          const read = await originalAll<T>();
          expect(read.results).toEqual([]);
          // The SELECT has completed with the irrelevant credential mapping.
          // A concurrent review now maps that same still-pending CONFLICT to
          // the credential used by the immutable version's real rule.
          h.sqlite.exec('UPDATE targetsolutions_rows SET credential_id=7002');
          remapped = true;
          afterConcurrentWrite = h.sqlite.serialize();
          return read;
        });
      }
      return statement;
    });
    expect(await prepareBidDefinitionRun(h.env.DB, input)).toMatchObject({
      ok: false,
      code: 'bid_definition_source_changed',
    });
    expect(remapped).toBe(true);
    expect(revision()).toBe(beforeRaceRevision + 1);
    deepStrictEqual(h.sqlite.serialize(), afterConcurrentWrite);
    expect(
      h.sqlite
        .prepare('SELECT classification,applied_at,credential_id FROM targetsolutions_rows')
        .get(),
    ).toEqual({
      classification: 'CONFLICT',
      applied_at: null,
      credential_id: 7002,
    });
    expect(await prepareBidDefinitionRun(h.env.DB, input)).toMatchObject({
      ok: false,
      code: 'credential_import_dispute_requires_review',
    });
    deepStrictEqual(h.sqlite.serialize(), afterConcurrentWrite);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_sessions').get()).toEqual({ n: 0 });
    expect(
      h.sqlite.prepare('SELECT COUNT(*) AS n FROM bid_session_policy_snapshots').get(),
    ).toEqual({ n: 0 });
  });
});
