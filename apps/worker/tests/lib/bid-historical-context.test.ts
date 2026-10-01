import type { HistoricalBid, HistoricalBidReceipt } from '@mbfd/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  loadPriorBidHistoricalContext,
  projectMemberHistoricalContext,
} from '../../src/lib/bid-historical-context.js';
import type { WorkerEnv } from '../../src/types/env.js';

const SOURCE_SHA = 'a'.repeat(64);

function archive(): HistoricalBid {
  return {
    schemaVersion: 1,
    year: 2025,
    label: 'Prior annual positions',
    notes: [],
    sources: [
      { id: 'shift-image', name: '2025 shift image', sha256: SOURCE_SHA },
      { id: 'workbook', name: '2025 employee crosswalk', sha256: 'b'.repeat(64) },
    ],
    seats: [
      {
        id: 'A109',
        shift: 'A',
        station: 'Station #1',
        unit: 'Rescue 1',
        position: 'Lieutenant',
        name: 'Documentary Name',
        group: 'GR4',
        status: 'AWARDED',
        sourceId: 'shift-image',
        sourceLocation: 'Station #1 / A109',
        note: null,
        employeeReference: {
          employeeId: '20731',
          sourceId: 'workbook',
          sourceLocation: 'Bid Pick!B68:G68',
        },
      },
    ],
  };
}

async function receipt(a = archive()): Promise<HistoricalBidReceipt> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(a)));
  return {
    archive: a,
    sha256: Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(''),
    publishedAt: '2026-09-07T20:10:22.622Z',
    publishedBy: 'test-publisher',
  };
}

function firstSeat(a: HistoricalBid): HistoricalBid['seats'][number] {
  const seat = a.seats[0];
  if (!seat) throw new Error('Fixture requires a historical seat');
  return seat;
}

function bucket(value: unknown) {
  const get = vi.fn().mockResolvedValue(value === null ? null : { json: async () => value });
  return { get, binding: { get } as unknown as WorkerEnv['R2_EXPORTS'] };
}

describe('documentary prior annual bid context', () => {
  it('uses the prior session year, verifies the receipt, and joins only the explicit employee ID', async () => {
    const r = await receipt();
    const b = bucket(r);
    const projection = await loadPriorBidHistoricalContext(b.binding, 2026);
    expect(b.get).toHaveBeenCalledExactlyOnceWith('historical-bids/v1/2025.json');
    expect(projectMemberHistoricalContext(projection, '20731')).toEqual({
      year: 2025,
      evidenceStatus: 'RECORDED',
      historicalPositionId: 'A109',
      positionLabel: 'Lieutenant',
      shift: 'A',
      station: 'Station #1',
      unit: 'Rescue 1',
      aDayGroup: 'GR4',
      sourceName: '2025 shift image',
      sourceSha256: SOURCE_SHA,
      sourceLocation: 'Station #1 / A109',
      archiveSha256: r.sha256,
    });
    expect(projectMemberHistoricalContext(projection, '99999')).toMatchObject({
      evidenceStatus: 'UNLINKED',
      historicalPositionId: null,
      aDayGroup: null,
      archiveSha256: r.sha256,
    });
  });

  it('never derives an employee link from a name, member ID, position ID, or absent award', async () => {
    const a = archive();
    firstSeat(a).employeeReference = undefined;
    const projection = await loadPriorBidHistoricalContext(bucket(await receipt(a)).binding, 2026);
    for (const identity of ['20731', 'Documentary Name', 'A109', undefined]) {
      expect(projectMemberHistoricalContext(projection, identity)).toMatchObject({
        evidenceStatus: 'UNLINKED',
        historicalPositionId: null,
        positionLabel: null,
      });
    }
  });

  it('fails closed for ambiguous employee references even when one award looks preferable', async () => {
    const a = archive();
    a.seats.push({ ...firstSeat(a), id: 'B401', shift: 'B', position: 'Captain', group: 'GR2' });
    const projection = await loadPriorBidHistoricalContext(bucket(await receipt(a)).binding, 2026);
    expect(projectMemberHistoricalContext(projection, '20731')).toMatchObject({
      evidenceStatus: 'UNLINKED',
      historicalPositionId: null,
      aDayGroup: null,
    });
  });

  it('preserves a source-bound prior assigned Days spot and a missing recorded A-Day', async () => {
    const a = archive();
    a.seats[0] = {
      ...firstSeat(a),
      id: 'D402',
      shift: 'D',
      station: 'Training',
      unit: '902',
      status: 'OFFICIAL_POSITION_SUPPLEMENT',
      note: 'Official 2025 assigned position',
      group: null,
    };
    const projection = await loadPriorBidHistoricalContext(bucket(await receipt(a)).binding, 2026);
    expect(projectMemberHistoricalContext(projection, '20731')).toMatchObject({
      evidenceStatus: 'RECORDED',
      historicalPositionId: 'D402',
      shift: 'D',
      aDayGroup: null,
    });
  });

  it('does not treat withdrawn or unnamed supplement positions as awards or proof of no prior bid', async () => {
    for (const status of ['WITHDRAWN', 'OFFICIAL_POSITION_SUPPLEMENT'] as const) {
      const a = archive();
      a.seats[0] = {
        ...firstSeat(a),
        id: 'D402',
        shift: 'D',
        status,
        name: null,
        note: status === 'OFFICIAL_POSITION_SUPPLEMENT' ? 'Official unassigned slot' : null,
      };
      const projection = await loadPriorBidHistoricalContext(
        bucket(await receipt(a)).binding,
        2026,
      );
      expect(projectMemberHistoricalContext(projection, '20731').evidenceStatus).toBe('UNLINKED');
    }
  });

  it.each(['missing', 'wrong-year', 'hash', 'schema', 'read-error', 'no-binding'])(
    'keeps the board usable with UNAVAILABLE history for %s evidence',
    async (failure) => {
      const r = await receipt();
      if (failure === 'wrong-year') r.archive.year = 2024;
      if (failure === 'hash') r.sha256 = 'f'.repeat(64);
      if (failure === 'schema') (r.archive as unknown as Record<string, unknown>).unexpected = true;
      const b = bucket(failure === 'missing' ? null : r);
      if (failure === 'read-error') b.get.mockRejectedValue(new Error('R2 unavailable'));
      const projection = await loadPriorBidHistoricalContext(
        failure === 'no-binding' ? undefined : b.binding,
        2026,
      );
      expect(projectMemberHistoricalContext(projection, '20731')).toEqual({
        year: 2025,
        evidenceStatus: 'UNAVAILABLE',
        historicalPositionId: null,
        positionLabel: null,
        shift: null,
        station: null,
        unit: null,
        aDayGroup: null,
        sourceName: null,
        sourceSha256: null,
        sourceLocation: null,
        archiveSha256: null,
      });
    },
  );

  it('uses the same schema normalization and UTF-8 hash algorithm as the archive publisher', async () => {
    const a = archive();
    firstSeat(a).name = 'Muñoz, Ángela';
    const r = await receipt(a);
    const incoming = structuredClone(r);
    incoming.archive.label = ` ${incoming.archive.label} `;
    const projection = await loadPriorBidHistoricalContext(bucket(incoming).binding, 2026);
    expect(projectMemberHistoricalContext(projection, '20731').evidenceStatus).toBe('RECORDED');
  });
});
