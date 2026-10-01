import {
  type HistoricalBidReceipt,
  HistoricalBidReceiptSchema,
  type MemberHistoricalContext,
} from '@mbfd/shared';
import type { WorkerEnv } from '../types/env.js';

type HistoricalContextProjection = {
  year: number;
  receipt: HistoricalBidReceipt | null;
};

/** One archive read per board request; documentary failures never change live Bid authority. */
export async function loadPriorBidHistoricalContext(
  bucket: Pick<WorkerEnv['R2_EXPORTS'], 'get'> | undefined,
  bidYear: number,
): Promise<HistoricalContextProjection> {
  const year = bidYear - 1;
  const unavailable = { year, receipt: null };
  try {
    const object = await bucket?.get(`historical-bids/v1/${year}.json`);
    if (!object) return unavailable;
    const parsed = HistoricalBidReceiptSchema.safeParse(await object.json());
    if (!parsed.success || parsed.data.archive.year !== year) return unavailable;
    // Match the publisher: strict schema normalization, JSON insertion order, UTF-8 bytes.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(parsed.data.archive)),
    );
    const sha256 = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(
      '',
    );
    if (sha256 !== parsed.data.sha256) return unavailable;
    return { year, receipt: parsed.data };
  } catch {
    return unavailable;
  }
}

export function projectMemberHistoricalContext(
  projection: HistoricalContextProjection,
  employeeId: string | undefined,
): MemberHistoricalContext {
  const context: MemberHistoricalContext = {
    year: projection.year,
    evidenceStatus: projection.receipt === null ? 'UNAVAILABLE' : 'UNLINKED',
    historicalPositionId: null,
    positionLabel: null,
    shift: null,
    station: null,
    unit: null,
    aDayGroup: null,
    sourceName: null,
    sourceSha256: null,
    sourceLocation: null,
    archiveSha256: projection.receipt?.sha256 ?? null,
  };
  if (!projection.receipt || !employeeId) return context;
  const { archive } = projection.receipt;
  const matches = archive.seats.filter(
    (seat) =>
      seat.employeeReference?.employeeId === employeeId &&
      seat.status !== 'WITHDRAWN' &&
      seat.name !== null,
  );
  // Absence and ambiguity do not establish a new hire or a prior-none exception.
  if (matches.length !== 1) return context;
  const seat = matches[0];
  if (seat === undefined) return context;
  const source = archive.sources.find((candidate) => candidate.id === seat.sourceId);
  if (!source) return context;
  return {
    ...context,
    evidenceStatus: 'RECORDED',
    historicalPositionId: seat.id,
    positionLabel: seat.position,
    shift: seat.shift,
    station: seat.station,
    unit: seat.unit,
    aDayGroup: seat.group,
    sourceName: source.name,
    sourceSha256: source.sha256,
    sourceLocation: seat.sourceLocation,
  };
}
