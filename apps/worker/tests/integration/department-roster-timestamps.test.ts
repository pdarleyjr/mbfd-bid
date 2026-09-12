import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDepartmentRosterProjection } from '../../src/lib/department-roster.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const AS_OF = '2026-09-12';
const OLD_MS = Date.UTC(2026, 8, 11, 12);
const NEW_MS = Date.UTC(2026, 8, 12, 12);

describe('Department source update timestamp units', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
  });
  afterEach(async () => teardownTestD1(h));

  function insertMember(id: number, timestamp: number) {
    h.sqlite
      .prepare(`INSERT INTO members
      (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
       is_probationary, employment_status, created_at, updated_at)
      VALUES (?, ?, 'Synthetic', 'Timestamp', 'FF', 'FF', ?, 0, 'active', ?, ?)`)
      .run(id, `synthetic-timestamp-${id}`, id, timestamp, timestamp);
  }

  async function timestamp() {
    const result = await loadDepartmentRosterProjection(h.env.DB, AS_OF, []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    return result.projection.updatedAt;
  }

  it('converts a members-only Drizzle timestamp in seconds into milliseconds', async () => {
    insertMember(1, NEW_MS / 1000);
    const before = h.sqlite.serialize();
    expect(await timestamp()).toBe(NEW_MS);
    expect(h.sqlite.serialize()).toEqual(before);
  });

  it('lets a newer seconds-based member update advance older staffing milliseconds', async () => {
    insertMember(1, NEW_MS / 1000);
    h.sqlite
      .prepare(`INSERT INTO staffing_positions
      (id, stable_slot_key, shift, station, position_name, applicable_rank,
       active_from, review_status, created_at, updated_at)
      VALUES ('synthetic-seat', 'SYNTHETIC/TIMESTAMP/SEAT', 'A', '1', 'Firefighter', 'FF',
       '2026-01-01', 'approved', ?, ?)`)
      .run(OLD_MS, OLD_MS);
    expect(await timestamp()).toBe(NEW_MS);
  });

  it('normalizes each mixed member row before MAX, not only the winning raw value', async () => {
    insertMember(1, OLD_MS);
    insertMember(2, NEW_MS / 1000);
    expect(await timestamp()).toBe(NEW_MS);
  });

  it('preserves the raw millisecond member timestamps written by personnel/import routes', async () => {
    insertMember(1, NEW_MS);
    expect(await timestamp()).toBe(NEW_MS);
  });
});
