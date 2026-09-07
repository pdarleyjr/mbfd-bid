import type { FrozenServiceCredit } from '@mbfd/shared';
export type ServiceEvidenceRow = FrozenServiceCredit & { memberId: number; revision: number };
/** Latest dated assertion for each stable member/service pair; absence stays unknown. */
export function serviceCreditsAsOf(
  rows: ServiceEvidenceRow[],
  memberId: number,
  asOf: string,
): FrozenServiceCredit[] {
  const selected = new Map<string, ServiceEvidenceRow>();
  for (const row of rows) {
    if (row.memberId !== memberId || row.effectiveOn > asOf) continue;
    const previous = selected.get(row.serviceCode);
    if (
      !previous ||
      row.effectiveOn > previous.effectiveOn ||
      (row.effectiveOn === previous.effectiveOn && row.revision > previous.revision)
    )
      selected.set(row.serviceCode, row);
  }
  return [...selected.values()]
    .sort((a, b) => a.serviceCode.localeCompare(b.serviceCode))
    .map(({ memberId: _member, revision: _revision, ...credit }) => credit);
}
