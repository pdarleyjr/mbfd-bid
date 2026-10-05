import { deepStrictEqual } from 'node:assert/strict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_STAFFING_KEY,
  type CurrentStaffingArchive,
  type CurrentStaffingReceipt,
  currentStaffingArchiveFromCsv,
  currentStaffingArchiveHash,
  loadCurrentStaffingContexts,
  loadCurrentStaffingReceipt,
  projectDirectoryCurrentStaffing,
} from '../../src/lib/current-staffing-source.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const SNAPSHOT = '2026-10-04T22:00:00.000Z';
const HEADERS =
  'Name,Employee ID,Email Address,Rank / Position,Shift,A Day,Station / Division,Seat / Unit,Bid Position,Email Match Status';
const CSV = `${HEADERS}\n"Synthetic, Captain",000123,private@example.invalid,Captain,B,2,Station 6,Fire Boat 6,Marine Captain,Exact\n"Synthetic, Days",000456,private2@example.invalid,Division Chief,D,,Prevention Division,Fire Inspector,Captain (INSP),Exact\n`;

async function receipt(archive?: CurrentStaffingArchive): Promise<CurrentStaffingReceipt> {
  const value =
    archive ??
    (await currentStaffingArchiveFromCsv(CSV, 'directory.csv', 'a'.repeat(64), SNAPSHOT));
  return {
    archive: value,
    sha256: await currentStaffingArchiveHash(value),
    publishedAt: SNAPSHOT,
    publishedBy: '99',
  };
}
function bucket(value: unknown) {
  const get = vi.fn().mockResolvedValue(value === null ? null : { json: async () => value });
  return { get, binding: { get } as unknown as WorkerEnv['R2_EXPORTS'] };
}

describe('current directory staffing evidence', () => {
  it('reads distinct staffing, rank, shift and A-Day columns and excludes names/contact fields', async () => {
    const archive = await currentStaffingArchiveFromCsv(
      CSV,
      'directory.csv',
      'a'.repeat(64),
      SNAPSHOT,
    );
    expect(archive.rows[0]).toEqual({
      employeeId: '000123',
      sourceRank: 'Captain',
      shift: 'B',
      aDayGroup: 'G2',
      station: 'Station 6',
      unit: 'Fire Boat 6',
      positionLabel: 'Marine Captain',
      sourceRow: 2,
    });
    expect(archive.rows[1]).toMatchObject({
      sourceRank: 'Division Chief',
      shift: 'D',
      aDayGroup: null,
      positionLabel: 'Captain (INSP)',
    });
    expect(JSON.stringify(archive)).not.toContain('private@example');
    expect(JSON.stringify(archive)).not.toContain('Synthetic');
  });

  it('rejects missing columns, unknown shifts, invalid groups and duplicate IDs without fuzzy linking', async () => {
    await expect(
      currentStaffingArchiveFromCsv(
        CSV.replace('Employee ID', 'Staff Number'),
        'directory.csv',
        'a'.repeat(64),
        SNAPSHOT,
      ),
    ).rejects.toThrow();
    await expect(
      currentStaffingArchiveFromCsv(
        CSV.replace(',B,2,', ',Z,2,'),
        'directory.csv',
        'a'.repeat(64),
        SNAPSHOT,
      ),
    ).rejects.toThrow();
    await expect(
      currentStaffingArchiveFromCsv(
        CSV.replace(',D,,', ',D,1,'),
        'directory.csv',
        'a'.repeat(64),
        SNAPSHOT,
      ),
    ).rejects.toThrow('current_staffing_days_group_invalid');
    await expect(
      currentStaffingArchiveFromCsv(
        CSV.replace('000456', '000123'),
        'directory.csv',
        'a'.repeat(64),
        SNAPSHOT,
      ),
    ).rejects.toThrow('current_staffing_identity_conflict');
  });

  it('verifies the private receipt and projects only one exact ID, preserving empty source values', async () => {
    const value = await receipt();
    const objects = bucket(value);
    expect(await loadCurrentStaffingReceipt(objects.binding)).toEqual(value);
    expect(objects.get).toHaveBeenCalledExactlyOnceWith(CURRENT_STAFFING_KEY);
    expect(projectDirectoryCurrentStaffing(value, '123').evidenceStatus).toBe('UNLINKED');
    const projection = projectDirectoryCurrentStaffing(value, '000123');
    expect(projection).toMatchObject({
      evidenceStatus: 'RECORDED',
      positionId: null,
      aDayGroup: 'G2',
      source: 'DIRECTORY_CSV',
      sourceName: 'directory.csv',
      sourceRow: 2,
    });
    expect(projection).not.toHaveProperty('employeeId');
    const row = value.archive.rows[0];
    if (!row) throw new Error('Synthetic row missing');
    row.station = null;
    row.unit = null;
    row.positionLabel = null;
    expect(projectDirectoryCurrentStaffing(value, '000123')).toMatchObject({
      evidenceStatus: 'RECORDED',
      positionLabel: null,
      station: null,
      unit: null,
    });
  });

  it('omits tampered, ambiguous or unavailable documentary receipts', async () => {
    const value = await receipt();
    const row = value.archive.rows[0];
    if (!row) throw new Error('Synthetic row missing');
    row.unit = 'Altered without new digest';
    expect(await loadCurrentStaffingReceipt(bucket(value).binding)).toBeNull();
    value.archive.rows.push(row);
    value.sha256 = await currentStaffingArchiveHash(value.archive);
    expect(await loadCurrentStaffingReceipt(bucket(value).binding)).toBeNull();
    expect(await loadCurrentStaffingReceipt(bucket(null).binding)).toBeNull();
  });
});

describe('current staffing source precedence without placement or bid writes', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.exec(`INSERT INTO members
      (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at)
      VALUES (1,'000123','Synthetic','Bidder','CPT','OFC',1,0,1,1);
      INSERT INTO staffing_positions
      (id,stable_slot_key,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at)
      VALUES ('old','SYNTHETIC/OLD','B','Station 4','Engine 4','Captain','CPT','2026-01-01','approved',1,1);
      INSERT INTO member_assignments
      (id,member_id,staffing_position_id,origin_type,origin_ref,status,effective_from,created_at,updated_at)
      VALUES ('assignment',1,'old','CORRECTION','synthetic prior placement','active','2026-09-01',1,1);`);
  });
  afterEach(async () => teardownTestD1(h));
  const identities = [{ memberId: 1, employeeId: '000123' }];

  it('uses the user-supplied directory over an older roster, preserving all database state', async () => {
    const before = h.sqlite.serialize();
    const result = await loadCurrentStaffingContexts(
      h.env.DB,
      bucket(await receipt()).binding,
      identities,
      '2026-10-05',
    );
    expect(result.get(1)).toMatchObject({
      source: 'DIRECTORY_CSV',
      positionId: null,
      shift: 'B',
      station: 'Station 6',
      unit: 'Fire Boat 6',
      positionLabel: 'Marine Captain',
      aDayGroup: 'G2',
    });
    deepStrictEqual(h.sqlite.serialize(), before);
  });

  it('permits a later reviewed same-day correction to supersede the directory', async () => {
    h.sqlite
      .prepare('UPDATE member_assignments SET updated_at=?')
      .run(Date.parse(SNAPSHOT) + 60000);
    const before = h.sqlite.serialize();
    const result = await loadCurrentStaffingContexts(
      h.env.DB,
      bucket(await receipt()).binding,
      identities,
      '2026-10-05',
    );
    expect(result.get(1)).toMatchObject({
      source: 'REVIEWED_STAFFING',
      positionId: 'old',
      station: 'Station 4',
      unit: 'Engine 4',
      positionLabel: 'Captain',
      aDayGroup: null,
    });
    deepStrictEqual(h.sqlite.serialize(), before);
  });

  it('uses a later effective placement even when its timestamps precede the source snapshot', async () => {
    h.sqlite.exec(`UPDATE member_assignments SET status='ended',effective_to='2026-10-04';
      INSERT INTO staffing_positions
      (id,stable_slot_key,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at)
      VALUES ('new','SYNTHETIC/NEW','A','Station 1','Engine 1','Captain','CPT','2026-01-01','approved',1,1);
      INSERT INTO member_assignments
      (id,member_id,staffing_position_id,origin_type,origin_ref,status,effective_from,created_at,updated_at)
      VALUES ('later',1,'new','CORRECTION','synthetic later placement','active','2026-10-05',1,1);`);
    const result = await loadCurrentStaffingContexts(
      h.env.DB,
      bucket(await receipt()).binding,
      identities,
      '2026-10-05',
    );
    expect(result.get(1)).toMatchObject({
      source: 'REVIEWED_STAFFING',
      positionId: 'new',
      shift: 'A',
    });
  });

  it('does not resurrect an old directory seat after a later reviewed cancellation', async () => {
    h.sqlite
      .prepare("UPDATE member_assignments SET status='cancelled',updated_at=?")
      .run(Date.parse(SNAPSHOT) + 60000);
    const result = await loadCurrentStaffingContexts(
      h.env.DB,
      bucket(await receipt()).binding,
      identities,
      '2026-10-05',
    );
    expect(result.get(1)?.evidenceStatus).toBe('UNAVAILABLE');
  });

  it('uses reviewed staffing when the receipt is absent or future dated', async () => {
    const result = await loadCurrentStaffingContexts(
      h.env.DB,
      bucket(null).binding,
      identities,
      '2026-10-05',
    );
    expect(result.get(1)).toMatchObject({ source: 'REVIEWED_STAFFING', positionId: 'old' });
    const future = await receipt();
    future.archive.snapshotAt = '2026-10-06T22:00:00.000Z';
    future.sha256 = await currentStaffingArchiveHash(future.archive);
    expect(
      (
        await loadCurrentStaffingContexts(
          h.env.DB,
          bucket(future).binding,
          identities,
          '2026-10-05',
        )
      ).get(1)?.source,
    ).toBe('REVIEWED_STAFFING');
  });

  it('keeps verified source context available if the auxiliary staffing query fails', async () => {
    const unavailable = vi.spyOn(h.env.DB, 'prepare').mockImplementation(() => {
      throw new Error('Synthetic outage');
    });
    try {
      const result = await loadCurrentStaffingContexts(
        h.env.DB,
        bucket(await receipt()).binding,
        identities,
        '2026-10-05',
      );
      expect(result.get(1)?.source).toBe('DIRECTORY_CSV');
    } finally {
      unavailable.mockRestore();
    }
  });
});
