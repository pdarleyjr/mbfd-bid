/** September 30 MASTER V4 supersedes V3 and the earlier Version 9 rehearsal. The
 * scheduled cutoff must fail closed until the reviewed source is actually
 * accepted, rather than sealing the older production population. These are
 * source identities, not inferred promotion dates or participant targets. */
export const LATEST_2026_MASTER_HASH =
  'a1bc6309bd7f565b98616226fd3cbe5fae6c6d7ce764188bdbfdd1eb8702e685';
export const LATEST_2026_ANNUAL_HASH =
  '37e6b2c65696eca2f8ce66c4d5a7ffc4e879264814ffc87725989c0b81ac451c';

/** Exact October 1 update identities. They are used only by an explicit new
 * reviewed-update capture; the original cutoff and its history keep the source
 * identities above. Neither source admission nor full row review invents
 * person-specific qualification evidence or clears a disputed assertion. */
export const OCTOBER1_2026_MASTER_HASH =
  'ab87dff9e920d97cfdc6ef401986a0ceb2ba14d99a61496d13fe75526f175d8b';
export const OCTOBER1_2026_ANNUAL_HASH =
  '8af7fb3e4f1e6a557fac3171ad6ccccca259afe4a1bdac0ce229e2c2674391e9';

interface SourceAcceptanceInput {
  versionNumber: number;
  sourceDecisions: readonly { issueId: string; status: string; sourceRef: string }[];
  members: readonly { employeeId: string; rank: string; bidCategory: string }[];
  credentialImports: readonly { coverageJson: string; rowCount: number; reviewedCount: number }[];
}

export function latest2026SourceCutoffIssue(input: SourceAcceptanceInput) {
  return reviewedSourceIssue(input, {
    masterHash: LATEST_2026_MASTER_HASH,
    annualHash: LATEST_2026_ANNUAL_HASH,
    credentialRevision: 4,
    selectedSheet: '2026_BID_Credentials_Version_4_',
  });
}

export function latest2026ReviewedSourceUpdateIssue(input: SourceAcceptanceInput) {
  return reviewedSourceIssue(input, {
    masterHash: OCTOBER1_2026_MASTER_HASH,
    annualHash: OCTOBER1_2026_ANNUAL_HASH,
    credentialRevision: 5,
    selectedSheet: '2026_BID_Credentials_Version_5_',
  });
}

function reviewedSourceIssue(
  input: SourceAcceptanceInput,
  source: {
    masterHash: string;
    annualHash: string;
    credentialRevision: number;
    selectedSheet: string;
  },
) {
  const rankDecision = input.sourceDecisions.find(
    (decision) => decision.issueId === '2026-latest-substantive-ranks',
  );
  if (
    input.versionNumber <= 9 ||
    rankDecision?.status !== 'RESOLVED' ||
    !rankDecision.sourceRef.includes(source.masterHash) ||
    !rankDecision.sourceRef.includes(source.annualHash)
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
      receipt?.workbook_hash === source.annualHash &&
      receipt.source_revision === source.credentialRevision &&
      receipt.selected_sheet === source.selectedSheet &&
      receipt.row_count === 3884 &&
      receipt.unique_employee_count === 230 &&
      batch.rowCount === 3884 &&
      batch.reviewedCount === batch.rowCount
    );
  });
  return reviewedRevision ? null : 'latest_2026_credential_revision_review_required';
}
