import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unstable_splitSqlQuery } from 'wrangler';

const migration = readFileSync(
  new URL('../../migrations/0072_final_portal_publication.sql', import.meta.url),
  'utf8',
);
const publicationSql = `INSERT INTO final_portal_publications
  VALUES (@id,'synthetic-real-0072',@sequence,@result,'workbook',@manifest,'{}',@receipt,1,0)`;
const publication = {
  id: 'publication-0072',
  sequence: 237,
  result: 'result',
  manifest: 'manifest',
  receipt: 'receipt',
};
const outboxSql = `INSERT INTO final_portal_outbox
  VALUES ('outbox-0072','publication-0072','synthetic-employee','A101','bid_award','{}','queued',0,0,NULL,NULL)`;

describe('final publication schema (migration 0072)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE members(id INTEGER PRIMARY KEY);
      CREATE TABLE bid_sessions(id TEXT PRIMARY KEY,is_mock INTEGER,current_phase TEXT);
      CREATE TABLE canonical_bid_session_state(bid_session_id TEXT,current_seq INTEGER,state_json TEXT);
      CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT);
      INSERT INTO members VALUES(1);
      INSERT INTO bid_sessions VALUES('synthetic-real-0072',0,'position_bid');
      INSERT INTO canonical_bid_session_state VALUES('synthetic-real-0072',237,'{"currentPhase":"complete"}');`);
    db.exec(migration);
  });
  afterEach(() => db.close());

  it('uses parenthesized CASE expressions in the exact native managed-migration format', () => {
    // D1 /query can mistake a bare CASE END for the trigger END (workers-sdk #4727).
    // Local SQLite and Wrangler splitting alone accept the incompatible spelling.
    expect(migration).not.toMatch(/\bSELECT\s+CASE\b/i);
    expect(migration.match(/\bSELECT\s+\(CASE\b/g)).toHaveLength(2);
    expect(migration).not.toContain('\r');
    const managed = `${migration}
INSERT INTO "d1_migrations" (name)
values ('0072_final_portal_publication.sql');`;
    const statements = unstable_splitSqlQuery(managed);
    expect(statements).toHaveLength(9);
    expect(statements.filter((sql) => sql.startsWith('CREATE TRIGGER'))).toHaveLength(5);
    const native = new Database(':memory:');
    try {
      native.exec(`CREATE TABLE members(id INTEGER PRIMARY KEY);
        CREATE TABLE bid_sessions(id TEXT PRIMARY KEY,is_mock INTEGER);
        CREATE TABLE canonical_bid_session_state(bid_session_id TEXT,current_seq INTEGER,state_json TEXT);
        CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT);`);
      for (const statement of statements) native.exec(statement);
      expect(native.prepare('SELECT name FROM d1_migrations').get()).toEqual({
        name: '0072_final_portal_publication.sql',
      });
    } finally {
      native.close();
    }
  });

  it('requires a matching canonically complete Real revision, independent of legacy phase', () => {
    expect(() => db.prepare(publicationSql).run({ ...publication, sequence: 236 })).toThrow(
      'final_publication_stale_or_not_real_complete',
    );
    db.exec(`UPDATE canonical_bid_session_state SET state_json='{"currentPhase":"position_bid"}'`);
    expect(() => db.prepare(publicationSql).run(publication)).toThrow(
      'final_publication_stale_or_not_real_complete',
    );
    db.exec(`UPDATE canonical_bid_session_state SET state_json='{"currentPhase":"complete"}';
      UPDATE bid_sessions SET is_mock=1`);
    expect(() => db.prepare(publicationSql).run(publication)).toThrow(
      'final_publication_stale_or_not_real_complete',
    );
    db.exec('UPDATE bid_sessions SET is_mock=0');
    db.prepare(publicationSql).run(publication);
    expect(db.prepare('SELECT COUNT(*) AS n FROM final_portal_publications').get()).toEqual({
      n: 1,
    });
  });

  it('rejects revision conflicts atomically without leaving an outbox row', () => {
    db.prepare(publicationSql).run(publication);
    for (const change of [
      { id: 'different' },
      { manifest: 'different' },
      { result: 'different' },
      { receipt: 'different' },
    ]) {
      const batch = db.transaction(() => {
        db.exec(outboxSql);
        db.prepare(publicationSql).run({ ...publication, ...change });
      });
      expect(batch).toThrow('final_publication_revision_conflict');
      expect(db.prepare('SELECT COUNT(*) AS n FROM final_portal_outbox').get()).toEqual({ n: 0 });
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM final_portal_publications').get()).toEqual({
      n: 1,
    });
  });

  it('preserves immutable publication and outbox history while allowing delivery progress', () => {
    db.prepare(publicationSql).run(publication);
    db.exec(outboxSql);
    expect(() => db.exec("UPDATE final_portal_publications SET manifest_json='[]'")).toThrow(
      'final_publication_immutable',
    );
    expect(() => db.exec('DELETE FROM final_portal_publications')).toThrow(
      'final_publication_immutable',
    );
    for (const [column, value] of Object.entries({
      id: 'different',
      publication_id: 'different',
      employee_id: 'different',
      position_id: 'A102',
      assignment_source: 'retained_nonbiddable',
      payload_json: '[]',
    })) {
      expect(() => db.prepare(`UPDATE final_portal_outbox SET ${column}=?`).run(value)).toThrow(
        'final_outbox_source_immutable',
      );
    }
    expect(() => db.exec('DELETE FROM final_portal_outbox')).toThrow(
      'final_outbox_history_retained',
    );
    db.exec(
      "UPDATE final_portal_outbox SET status='done',attempts=2,next_attempt_at=5,synced_at=10",
    );
    expect(
      db.prepare('SELECT payload_json,status,attempts FROM final_portal_outbox').get(),
    ).toEqual({
      payload_json: '{}',
      status: 'done',
      attempts: 2,
    });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});
