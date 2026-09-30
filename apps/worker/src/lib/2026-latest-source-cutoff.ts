/** September 29 evidence supersedes the earlier Version 9 rehearsal. The
 * scheduled cutoff must fail closed until the reviewed source is actually
 * accepted, rather than sealing the older production population. These are
 * source identities, not inferred promotion dates or participant targets. */
export const LATEST_2026_MASTER_HASH =
  '3631427507fa7ca0280a03e9b0a14a2429bbafad3404d46f5cef4a1ce679b57d';
export const LATEST_2026_ANNUAL_HASH =
  '37e6b2c65696eca2f8ce66c4d5a7ffc4e879264814ffc87725989c0b81ac451c';

export function latest2026SourceCutoffIssue(input: {
  versionNumber: number;
  sourceDecisions: readonly { issueId: string; status: string; sourceRef: string }[];
  members: readonly { employeeId: string; rank: string; bidCategory: string }[];
  credentialImports: readonly { coverageJson: string; rowCount: number; reviewedCount: number }[];
}) {
  const rankDecision = input.sourceDecisions.find(
    (decision) => decision.issueId === '2026-latest-substantive-ranks',
  );
  if (
    input.versionNumber <= 9 ||
    rankDecision?.status !== 'RESOLVED' ||
    !rankDecision.sourceRef.includes(LATEST_2026_MASTER_HASH) ||
    !rankDecision.sourceRef.includes(LATEST_2026_ANNUAL_HASH)
  )
    return 'latest_2026_source_version_required';
  const expected = [
    ['17594', 'CPT', 'OFC'],
    ['17836', 'LT', 'OFC'],
    ['18148', 'DC', 'EXCLUDED'],
  ] as const;
  if (
    expected.some(
      ([employeeId, rank, bidCategory]) =>
        !input.members.some(
          (member) =>
            member.employeeId === employeeId &&
            member.rank === rank &&
            member.bidCategory === bidCategory,
        ),
    )
  )
    return 'latest_2026_personnel_corrections_required';
  const reviewedRevision = input.credentialImports.some((batch) => {
    let coverage: unknown;
    try {
      coverage = JSON.parse(batch.coverageJson);
    } catch {
      return false;
    }
    const receipt = (coverage as { sourceReceipt?: Record<string, unknown> } | null)?.sourceReceipt;
    return (
      receipt?.workbook_hash === LATEST_2026_ANNUAL_HASH &&
      receipt.source_revision === 4 &&
      receipt.selected_sheet === '2026_BID_Credentials_Version_4_' &&
      receipt.row_count === 3884 &&
      receipt.unique_employee_count === 230 &&
      batch.rowCount === 3884 &&
      batch.reviewedCount === batch.rowCount
    );
  });
  return reviewedRevision ? null : 'latest_2026_credential_revision_review_required';
}
