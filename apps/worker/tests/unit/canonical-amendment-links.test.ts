import type { D1Database } from '@cloudflare/workers-types';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { loadCanonicalAmendmentLinks } from '../../src/routes/admin/post-bid-transition.js';

function d1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          args = values;
          return this;
        },
        async all() {
          const results = sqlite.prepare(query).all(...args);
          return { success: true, results, meta: {} };
        },
      };
    },
  } as unknown as D1Database;
}

describe('canonical post-Bid amendment provenance', () => {
  it('projects replacement links from immutable canonical command events only', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE bid_command_events (
        id TEXT PRIMARY KEY,
        bid_session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE bid_award_amendments (
        original_bid_id TEXT NOT NULL,
        replacement_bid_id TEXT NOT NULL,
        bid_session_id TEXT NOT NULL
      );
    `);
    const insert = sqlite.prepare(
      'INSERT INTO bid_command_events (id,bid_session_id,seq,event_json) VALUES (?,?,?,?)',
    );
    insert.run(
      'event-1',
      'session-1',
      2,
      JSON.stringify({
        operation: 'amend_selection',
        supersedesBidId: 'award-1',
        replacementBidId: 'award-2',
      }),
    );
    insert.run('event-2', 'session-1', 3, JSON.stringify({ operation: 'pause' }));
    sqlite
      .prepare(
        'INSERT INTO bid_award_amendments (original_bid_id,replacement_bid_id,bid_session_id) VALUES (?,?,?)',
      )
      .run('legacy-award', 'legacy-replacement', 'session-1');

    await expect(loadCanonicalAmendmentLinks(d1(sqlite), 'session-1')).resolves.toEqual([
      { original_bid_id: 'award-1', replacement_bid_id: 'award-2' },
    ]);
  });
});
