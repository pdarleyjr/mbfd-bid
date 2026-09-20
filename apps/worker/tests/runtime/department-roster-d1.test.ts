import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { loadDepartmentRosterProjection } from '../../src/lib/department-roster.js';

describe('Department roster on the Workers D1 runtime', () => {
  it('reads an empty projection within D1 query limits without writing any data', async () => {
    const result = await loadDepartmentRosterProjection(env.DB, '2026-09-19', []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.projection.updatedAt).toBeNull();
    expect(result.projection.summary).toEqual({
      totalPositions: 0,
      occupiedPositions: 0,
      vacantPositions: 0,
    });
    expect(result.projection.unassignedMembers).toEqual([]);
  });

  it('selects the newest normalized timestamp across populated and empty sources', async () => {
    const newest = Date.UTC(2026, 8, 19, 12);
    const older = newest - 86_400_000;
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO members
          (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
           is_probationary, employment_status, created_at, updated_at)
          VALUES (990001, 'synthetic-d1-timestamp', 'Synthetic', 'Timestamp',
            'FF', 'FF', 990001, 0, 'active', ?, ?)`).bind(newest / 1000, newest / 1000),
        env.DB.prepare(`INSERT INTO staffing_positions
          (id, stable_slot_key, shift, station, position_name, applicable_rank,
           active_from, review_status, created_at, updated_at)
          VALUES ('synthetic-d1-seat', 'SYNTHETIC/D1/SEAT', 'A', '1', 'Firefighter', 'FF',
            '2026-01-01', 'approved', ?, ?)`).bind(older, older),
      ]);
      const result = await loadDepartmentRosterProjection(env.DB, '2026-09-19', []);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.projection.updatedAt).toBe(newest);
      expect(result.projection.summary).toEqual({
        totalPositions: 1,
        occupiedPositions: 0,
        vacantPositions: 1,
      });
      const member = await env.DB.prepare(
        'SELECT updated_at FROM members WHERE id = 990001',
      ).first<{ updated_at: number }>();
      expect(member?.updated_at).toBe(newest / 1000);
    } finally {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM staffing_positions WHERE id = 'synthetic-d1-seat'"),
        env.DB.prepare('DELETE FROM members WHERE id = 990001'),
      ]);
    }
  });
});
