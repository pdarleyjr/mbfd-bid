import { BidOrdinalImportSchema, type FrozenBidOrdinalEvidence } from '@mbfd/shared';

export type BidOrdinalDatasetRow = {
  id: string;
  bidYear: number;
  sourceSha256: string;
  sourceRef: string;
  entriesJson: string;
};
/** Recheck immutable imported identities against this capture. Missing or
 * changed identities remain missing evidence; never fall back to RSC or names. */
export function projectBidOrdinals(
  dataset: BidOrdinalDatasetRow | undefined,
  members: readonly { id: number; employeeId: string }[],
): Map<number, FrozenBidOrdinalEvidence> {
  const result = new Map<number, FrozenBidOrdinalEvidence>();
  if (!dataset) return result;
  let entries: unknown;
  try {
    entries = JSON.parse(dataset.entriesJson);
  } catch {
    return result;
  }
  const parsed = BidOrdinalImportSchema.safeParse({
    bidYear: dataset.bidYear,
    expectedRevision: 0,
    sourceSha256: dataset.sourceSha256,
    sourceRef: dataset.sourceRef,
    reason: 'Frozen source projection',
    entries,
  });
  if (!parsed.success) return result;
  for (const row of parsed.data.entries) {
    const matching = members.filter(
      (member) => member.id === row.memberId && member.employeeId === row.employeeId,
    );
    if (
      matching.length !== 1 ||
      members.filter((member) => member.employeeId === row.employeeId).length !== 1
    )
      continue;
    result.set(row.memberId, {
      datasetId: dataset.id,
      sourceSha256: dataset.sourceSha256,
      timeInGrade: row.timeInGrade,
      departmentService: row.departmentService,
    });
  }
  return result;
}
