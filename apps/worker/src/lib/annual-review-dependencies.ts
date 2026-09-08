import type { BidSessionPolicySnapshot } from '@mbfd/shared';

type Snapshot = Extract<BidSessionPolicySnapshot, { v: 3 }>;
/** Compare the complete input groups used by approval; do not substitute global revision counters for material changes. */
export function annualReviewMaterial(s: Snapshot) {
  return {
    'Designated setup': {
      book: s.ruleBookVersion,
      revision: s.ruleBookRevision,
      template: s.positionTemplateVersion,
      configuration: s.configurationRevision,
    },
    'Staffing baseline': s.staffingBaseline,
    'Dates and operating settings': s.settings,
    'Participants, qualifications and service': s.members,
    'Protected terms': s.tenureEvidence,
    'Qualification names': s.authoringCredentialNames,
    'Positions, requirements and scoring': s.ruleBookMaterial,
    'Annual policy': s.annualPolicyEvidence,
  };
}
export function changedAnnualDependencies(before: Snapshot, after: Snapshot) {
  const previous = annualReviewMaterial(before);
  const current = annualReviewMaterial(after);
  return (Object.keys(previous) as (keyof typeof previous)[]).filter(
    (key) => JSON.stringify(previous[key]) !== JSON.stringify(current[key]),
  );
}
