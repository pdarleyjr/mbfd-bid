import { describe, it, expect } from 'vitest';
import { getDb, schema } from '../src/db';

describe('db wiring (integration smoke)', () => {
  it('getDb returns a Drizzle client and schema is reachable from it', () => {
    const mockD1 = {
      prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
    } as unknown as D1Database;
    const db = getDb(mockD1);
    expect(db).toBeDefined();
    expect(typeof db.select).toBe('function');
    expect(schema.members).toBeDefined();
    expect(schema.bidSessions).toBeDefined();
  });
});
