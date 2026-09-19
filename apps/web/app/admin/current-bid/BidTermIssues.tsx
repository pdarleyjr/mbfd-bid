export function BidTermIssues({
  issues,
}: { issues: readonly { positionId: string; code: string; sourceRef: string }[] | undefined }) {
  if (!issues?.length) return null;
  const labels: Record<string, string> = {
    term_binding_required: 'Link this opportunity to its reviewed Department position.',
    term_holder_ambiguous: 'Review overlapping holders before bidding this assignment.',
    term_evidence_required: 'Record the reviewed assignment term.',
    term_holder_service_evidence_required:
      'Record this holder’s accumulated service and consecutive bid cycles.',
    term_service_cycle_conflict: 'Reconcile the conflicting service and bid-cycle evidence.',
    protected_term_cannot_be_biddable:
      'The incumbent has not completed the protected term; close this opportunity.',
    completed_cycles_require_annual_reopening:
      'The incumbent completed the required bid cycles; reopen this opportunity.',
    term_annual_closure_required: 'The governing policy closes this opportunity for this Bid.',
  };
  return (
    <ul className="list-disc space-y-2 pl-5 text-sm">
      {issues.map((issue) => (
        <li key={`${issue.positionId}:${issue.code}`}>
          {issue.positionId}: {labels[issue.code] ?? issue.code.replaceAll('_', ' ')}
          <span className="block text-muted-foreground">Source: {issue.sourceRef}</span>
        </li>
      ))}
    </ul>
  );
}
