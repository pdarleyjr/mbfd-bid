import {
  type PersonnelLifecycleProjectionEvent,
  type PersonnelMemberState,
  derivePersonnelMemberAsOf,
} from './personnel-lifecycle.js';

/** Reuse the personnel ledger's before-first-event and effective-date semantics. */
export async function loadDepartmentPersonnel(db: D1Database, asOf: string) {
  const members = await db
    .prepare(`SELECT member.id, employee_id AS employeeId,
    first_name AS firstName, last_name AS lastName, rank,
    employment_status AS employmentStatus,
    employment_status_effective_on AS employmentStatusEffectiveOn,
    separation_type AS separationType,
    EXISTS (SELECT 1 FROM member_assignments assignment
      WHERE assignment.member_id = member.id
        AND (assignment.status IN ('planned', 'active')
          OR (assignment.status IN ('ended', 'superseded') AND assignment.effective_to IS NOT NULL))
        AND assignment.effective_from <= ?
        AND (assignment.effective_to IS NULL OR assignment.effective_to >= ?)) AS hasAssignment
    FROM members member ORDER BY last_name, first_name, id`)
    .bind(asOf, asOf)
    .all<PersonnelMemberState & { hasAssignment: number }>();
  const events = await db
    .prepare(`SELECT id, member_id AS memberId, kind,
    effective_on AS effectiveOn, employment_status_after AS employmentStatusAfter,
    rank_after AS rankAfter, separation_type AS separationType, before_state AS beforeState,
    created_at AS createdAt FROM personnel_lifecycle_events WHERE member_id IS NOT NULL`)
    .all<PersonnelLifecycleProjectionEvent & { memberId: number }>();
  const byMember = new Map<number, PersonnelLifecycleProjectionEvent[]>();
  for (const event of events.results) {
    const memberEvents = byMember.get(event.memberId) ?? [];
    memberEvents.push(event);
    byMember.set(event.memberId, memberEvents);
  }
  return members.results.map((member) => ({
    ...derivePersonnelMemberAsOf(member, byMember.get(member.id) ?? [], asOf),
    hasAssignment: member.hasAssignment === 1,
  }));
}
