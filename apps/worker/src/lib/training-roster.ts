import { RANK_LABELS, type Rank } from '@mbfd/shared';
import { loadDepartmentPersonnel } from './department-personnel.js';
import { isCalendarDate, loadDepartmentRosterProjection } from './department-roster.js';
import type { EmploymentStatus } from './personnel-lifecycle.js';

export interface TrainingRosterMember {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  rank: string | null;
  shift: string | null;
  assignment_id: string | null;
  assignment_source: string | null;
  effective_from: string | null;
  effective_to: string | null;
  employment_status: EmploymentStatus;
  /** Bridge availability only; Hub must also require its canonical active employee. */
  eligible: boolean;
}

/** Preserve actual Days and D Shift values; do not infer a duty schedule from a seat name. */
export function trainingShift(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.trim().toUpperCase();
  if (value === 'DAYS') return 'Days';
  const match = /^([ABCD])(?: SHIFT)?$/.exec(value);
  return match?.[1] ? `${match[1]} Shift` : null;
}

/** A machine-readable view of the existing effective staffing ledger, never of latest awards. */
export async function loadTrainingRoster(db: D1Database, asOf: string) {
  if (!isCalendarDate(asOf)) return { ok: false as const, error: 'invalid_as_of' };
  const result = await loadDepartmentRosterProjection(db, asOf, []);
  if (!result.ok) return result;
  const personnel = await loadDepartmentPersonnel(db, asOf);
  const rawPositions = await db
    .prepare('SELECT id, shift FROM staffing_positions')
    .all<{ id: string; shift: string | null }>();
  const rawShift = new Map(rawPositions.results.map((position) => [position.id, position.shift]));
  // The display projection chooses a latest occupant per seat. Refuse ambiguity rather
  // than letting that display choice conceal overlapping effective assignment records.
  const overlaps = await db
    .prepare(`SELECT member_id FROM member_assignments
    WHERE (status IN ('planned', 'active') OR (status IN ('ended', 'superseded') AND effective_to IS NOT NULL))
      AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
    GROUP BY member_id HAVING COUNT(*) > 1
    UNION ALL
    SELECT member_id FROM member_assignments
    WHERE (status IN ('planned', 'active') OR (status IN ('ended', 'superseded') AND effective_to IS NOT NULL))
      AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
    GROUP BY staffing_position_id HAVING COUNT(*) > 1`)
    .bind(asOf, asOf, asOf, asOf)
    .all();
  if (overlaps.results.length > 0) return { ok: false as const, error: 'assignment_overlap' };
  const positions = new Map<number, (typeof result.projection.positions)[number]>();
  for (const position of result.projection.positions) {
    if (position.member !== null && position.assignment !== null) {
      if (positions.has(position.member.id))
        return { ok: false as const, error: 'assignment_overlap' };
      positions.set(position.member.id, position);
    }
  }
  const identifiers = new Set<string>();
  const members: TrainingRosterMember[] = [];
  for (const member of personnel) {
    if (member.employeeId.trim() === '' || identifiers.has(member.employeeId)) {
      return { ok: false as const, error: 'employee_identity_ambiguous' };
    }
    identifiers.add(member.employeeId);
    const position = positions.get(member.id);
    const assignment = position?.assignment ?? null;
    members.push({
      employee_id: member.employeeId,
      first_name: member.firstName || null,
      last_name: member.lastName || null,
      rank: member.rank === 'CIVILIAN' ? 'Civilian' : (RANK_LABELS[member.rank as Rank] ?? null),
      shift: position ? trainingShift(rawShift.get(position.id) ?? null) : null,
      assignment_id: assignment?.id ?? null,
      assignment_source: assignment?.originType ?? null,
      effective_from: assignment?.effectiveFrom ?? null,
      effective_to: assignment?.effectiveTo ?? null,
      employment_status: member.employmentStatus,
      // The operational roster includes imported assignments whose lifecycle status
      // is still unknown. Preserve that evidence; Hub independently requires an
      // active canonical employee. This does not authorize Bid personnel mutations.
      eligible: member.employmentStatus === 'active' || member.employmentStatus === 'unknown',
    });
  }
  return {
    ok: true as const,
    payload: {
      schema_version: 1,
      as_of: asOf,
      generated_at: new Date().toISOString(),
      source_updated_at: result.projection.updatedAt,
      // Staffing is year-round. An annual award label is not evidence of activation.
      term_label: null,
      members,
    },
  };
}
