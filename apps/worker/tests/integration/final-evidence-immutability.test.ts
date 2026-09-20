import {
  BidOrdinalImportSchema,
  FrozenBidOrdinalEvidenceSchema,
  bidOrdinalValue,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('new annual evidence migration immutability', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('recursive_triggers = OFF');
    h.sqlite.exec(`INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
      VALUES (101,'synthetic-evidence-member','Synthetic','Evidence','FF','FF',1,1,1);
      INSERT INTO bid_sessions (id,bid_year,started_at,current_phase,is_mock,config_json)
      VALUES ('synthetic-evidence-session',2027,1,'complete',0,'{}');`);
  });
  afterEach(async () => teardownTestD1(h));

  it.each(['memberId', 'timeInGrade', 'departmentService'] as const)(
    'rejects unsafe integer %s before precision can be lost',
    (field) => {
      const entry = {
        memberId: 101,
        employeeId: 'synthetic-evidence-member',
        timeInGrade: 1,
        departmentService: 1,
        [field]: Number.MAX_SAFE_INTEGER + 1,
      };
      expect(
        BidOrdinalImportSchema.safeParse({
          bidYear: 2027,
          expectedRevision: 0,
          sourceSha256: 'a'.repeat(64),
          sourceRef: 'Synthetic source',
          reason: 'Synthetic review',
          entries: [entry],
        }).success,
      ).toBe(false);
      if (field === 'memberId') return;
      const evidence = {
        datasetId: 'synthetic',
        sourceSha256: 'a'.repeat(64),
        timeInGrade: entry.timeInGrade,
        departmentService: entry.departmentService,
      };
      expect(FrozenBidOrdinalEvidenceSchema.safeParse(evidence).success).toBe(false);
      expect(
        bidOrdinalValue(
          { rscSeniority: 1, rankSeniority: 1, bidOrdinalEvidence: evidence },
          field === 'timeInGrade' ? 'TIME_IN_GRADE_BID_ORDINAL' : 'DEPARTMENT_SERVICE_BID_ORDINAL',
        ),
      ).toBeNull();
    },
  );

  function expectBytesUnchanged(before: Uint8Array) {
    const after = h.sqlite.serialize();
    expect(after.length).toBe(before.length);
    expect(after.every((byte, index) => byte === before[index])).toBe(true);
  }

  function ordinal(id: string, revision: number, key: string, prefix = 'INSERT') {
    h.sqlite
      .prepare(`${prefix} INTO bid_ordinal_datasets
      (id,bid_year,revision,source_sha256,source_ref,entries_json,actor_subject,reason,idempotency_key,request_json,created_at)
      VALUES (?,2027,?,?,'Synthetic ordinal source',?,'synthetic-actor','Synthetic import',?,'{}',1)`)
      .run(
        id,
        revision,
        'a'.repeat(64),
        JSON.stringify([
          {
            memberId: 101,
            employeeId: 'synthetic-evidence-member',
            timeInGrade: revision,
            departmentService: revision,
          },
        ]),
        key,
      );
  }
  function tour(id: string, revision: number, key: string, prefix = 'INSERT') {
    h.sqlite
      .prepare(`${prefix} INTO member_bid_tour_evidence
      (id,member_id,revision,effective_on,completed_days_tour,source_ref,actor_subject,reason,idempotency_key,request_json,created_at)
      VALUES (?,101,?,'2027-01-01',1,'Synthetic tour source','synthetic-actor','Synthetic review',?,'{}',1)`)
      .run(id, revision, key);
  }
  it.each(['ordinal', 'tour'] as const)(
    '%s cannot replace a sealed source identity at the next revision',
    (kind) => {
      const write = kind === 'ordinal' ? ordinal : tour;
      write('original', 1, 'original-key');
      const bytes = h.sqlite.serialize();
      expect(() => write('original', 2, 'next-key', 'INSERT OR REPLACE')).toThrow();
      expectBytesUnchanged(bytes);
    },
  );
  it.each(['ordinal', 'tour'] as const)(
    '%s cannot replace a sealed idempotency identity at the next revision',
    (kind) => {
      const write = kind === 'ordinal' ? ordinal : tour;
      write('original', 1, 'original-key');
      const bytes = h.sqlite.serialize();
      expect(() => write('next', 2, 'original-key', 'INSERT OR REPLACE')).toThrow();
      expectBytesUnchanged(bytes);
    },
  );
  it('distribution evidence cannot replace an already reviewed revision', () => {
    const write = (evidence: string, prefix = 'INSERT') =>
      h.sqlite
        .prepare(`${prefix} INTO bid_result_distribution_reviews
      (id,bid_session_id,completion_seq,completion_command_id,package_sha256,channel,revision,status,published_on,evidence_ref,reason,actor_subject,created_at)
      VALUES ('original','synthetic-evidence-session',1,'synthetic-completion',?,'EMAIL',1,'COMPLETED','2027-01-01',?,'Synthetic review','synthetic-actor',1)`)
        .run('b'.repeat(64), evidence);
    write('Original reviewed evidence');
    const bytes = h.sqlite.serialize();
    expect(() => write('Replaced evidence', 'INSERT OR REPLACE')).toThrow();
    expectBytesUnchanged(bytes);
  });
  it.each(['rowid', '_rowid_', 'oid'])(
    'rejects explicit %s replacement without depending on recursive triggers',
    (alias) => {
      ordinal('original', 1, 'original-key');
      tour('original', 1, 'original-key');
      const bytes = h.sqlite.serialize();
      expect(() =>
        h.sqlite.exec(`INSERT OR REPLACE INTO bid_ordinal_datasets
      (${alias},id,bid_year,revision,source_sha256,source_ref,entries_json,actor_subject,reason,idempotency_key,request_json,created_at)
      SELECT rowid,'different-id',bid_year,revision+1,source_sha256,source_ref,entries_json,actor_subject,reason,'different-key',request_json,created_at
      FROM bid_ordinal_datasets WHERE id='original'`),
      ).toThrow();
      expect(() =>
        h.sqlite.exec(`INSERT OR REPLACE INTO member_bid_tour_evidence
      (${alias},id,member_id,revision,effective_on,completed_days_tour,source_ref,actor_subject,reason,idempotency_key,request_json,created_at)
      SELECT rowid,'different-id',member_id,revision+1,effective_on,completed_days_tour,source_ref,actor_subject,reason,'different-key',request_json,created_at
      FROM member_bid_tour_evidence WHERE id='original'`),
      ).toThrow();
      expectBytesUnchanged(bytes);
    },
  );
  it('allows a new immutable revision and leaves both original sources available', () => {
    for (const write of [ordinal, tour]) {
      write('original', 1, 'original-key');
      write('next', 2, 'next-key');
    }
    for (const table of ['bid_ordinal_datasets', 'member_bid_tour_evidence'])
      expect(h.sqlite.prepare(`SELECT id,revision FROM ${table} ORDER BY revision`).all()).toEqual([
        { id: 'original', revision: 1 },
        { id: 'next', revision: 2 },
      ]);
  });
  it.each(['timeInGrade', 'departmentService'] as const)(
    'direct SQL cannot persist unsafe %s',
    (field) => {
      const entries = [
        {
          memberId: 101,
          employeeId: 'synthetic-evidence-member',
          timeInGrade: 1,
          departmentService: 1,
          [field]: Number.MAX_SAFE_INTEGER + 1,
        },
      ];
      const before = h.sqlite.serialize();
      expect(() =>
        h.sqlite
          .prepare(`INSERT INTO bid_ordinal_datasets
      (id,bid_year,revision,source_sha256,source_ref,entries_json,actor_subject,reason,idempotency_key,request_json,created_at)
      VALUES ('unsafe',2027,1,?,'Synthetic source',?,'synthetic','Synthetic review','unsafe','{}',1)`)
          .run('a'.repeat(64), JSON.stringify(entries)),
      ).toThrow('safe integers');
      expectBytesUnchanged(before);
    },
  );
  it.each(['rowid', '_rowid_', 'oid'])(
    'distribution cannot replace through %s with a different logical identity',
    (alias) => {
      h.sqlite
        .prepare(`INSERT INTO bid_result_distribution_reviews
      (id,bid_session_id,completion_seq,completion_command_id,package_sha256,channel,revision,status,published_on,evidence_ref,reason,actor_subject,created_at)
      VALUES ('original','synthetic-evidence-session',1,'synthetic-completion',?,'EMAIL',1,'COMPLETED','2027-01-01',
      'Original reviewed evidence','Synthetic review','synthetic',1)`)
        .run('b'.repeat(64));
      const before = h.sqlite.serialize();
      expect(() =>
        h.sqlite.exec(`INSERT OR REPLACE INTO bid_result_distribution_reviews
      (${alias},id,bid_session_id,completion_seq,completion_command_id,package_sha256,channel,revision,status,published_on,evidence_ref,reason,actor_subject,created_at)
      SELECT rowid,'different',bid_session_id,completion_seq,completion_command_id,package_sha256,channel,revision+1,status,published_on,
      'Changed evidence',reason,actor_subject,created_at FROM bid_result_distribution_reviews WHERE id='original'`),
      ).toThrow();
      expectBytesUnchanged(before);
    },
  );
});
