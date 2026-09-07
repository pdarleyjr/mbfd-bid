export type TenureEvidence = {
  id: string;
  staffingPositionId: string;
  revision: number;
  effectiveOn: string;
  status: 'PROTECTED' | 'UNPROTECTED' | 'UNKNOWN';
  memberId: number | null;
  protectedFrom: string | null;
  protectedThrough: string | null;
  sourceRef: string;
  reason: string;
  actorSubject: string;
};
export async function loadTenureAsOf(db: D1Database, asOf: string) {
  return (
    await db
      .prepare(`SELECT t.id,t.staffing_position_id AS staffingPositionId,t.revision,t.effective_on AS effectiveOn,t.status,t.member_id AS memberId,t.protected_from AS protectedFrom,t.protected_through AS protectedThrough,t.source_ref AS sourceRef,t.reason,t.actor_subject AS actorSubject
    FROM staffing_tenure_evidence t WHERE t.effective_on<=? AND NOT EXISTS(SELECT 1 FROM staffing_tenure_evidence newer WHERE newer.staffing_position_id=t.staffing_position_id AND newer.effective_on<=? AND newer.revision>t.revision) ORDER BY t.staffing_position_id`)
      .bind(asOf, asOf)
      .all<TenureEvidence>()
  ).results;
}
export function isProtectedTenure(record: TenureEvidence, asOf: string) {
  return (
    record.status === 'PROTECTED' &&
    record.protectedFrom !== null &&
    record.protectedThrough !== null &&
    record.protectedFrom <= asOf &&
    record.protectedThrough >= asOf
  );
}

export function tenureEvidenceAsOf(rows: readonly TenureEvidence[], asOf: string) {
  const latest = new Map<string, TenureEvidence>();
  for (const row of rows) {
    if (row.effectiveOn > asOf) continue;
    const old = latest.get(row.staffingPositionId);
    if (!old || row.revision > old.revision) latest.set(row.staffingPositionId, row);
  }
  return [...latest.values()].sort((a, b) =>
    a.staffingPositionId.localeCompare(b.staffingPositionId),
  );
}

/** Checks reviewed facts against the same dated assignments used for pool exclusion.
 * No current seat, label, or historical award is treated as proof of a term. */
export function tenureParticipationIssues(input: {
  asOf: string;
  records: readonly TenureEvidence[];
  bindings: readonly { positionId: string; staffingPositionId: string; reviewStatus: string }[];
  nonBiddablePositionIds: readonly string[];
  assignments: readonly { staffingPositionId: string; memberId: number }[];
}) {
  const issues: { staffingPositionId: string; code: string; recordId: string }[] = [];
  const closed = new Set(input.nonBiddablePositionIds);
  for (const record of input.records) {
    const bindings = input.bindings.filter(
      (b) => b.staffingPositionId === record.staffingPositionId,
    );
    let code: string | undefined;
    if (record.status === 'UNKNOWN' && bindings.length) code = 'tenure_status_unknown';
    if (isProtectedTenure(record, input.asOf)) {
      if (bindings.length !== 1 || bindings[0]?.reviewStatus !== 'approved')
        code = 'protected_seat_binding_required';
      else if (!closed.has(bindings[0].positionId)) code = 'protected_seat_cannot_be_biddable';
      else {
        const holders = input.assignments.filter(
          (a) => a.staffingPositionId === record.staffingPositionId,
        );
        if (holders.length !== 1 || holders[0]?.memberId !== record.memberId)
          code = 'protected_holder_assignment_requires_review';
      }
    }
    if (code)
      issues.push({ staffingPositionId: record.staffingPositionId, code, recordId: record.id });
  }
  return issues;
}
