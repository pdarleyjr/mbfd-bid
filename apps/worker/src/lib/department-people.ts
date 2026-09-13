import type {
  DepartmentEmploymentStatus,
  DepartmentPeopleListResponse,
  DepartmentPerson,
  DepartmentPersonDetailResponse,
} from '@mbfd/shared';

import { loadDepartmentPersonnel } from './department-personnel.js';
import { loadDepartmentRosterProjection } from './department-roster.js';
import { isIsoCalendarDate } from './personnel-lifecycle.js';
import {
  type LegacyCredentialBaseline,
  type PersistedQualificationLifecycleEvent,
  type QualificationLifecycleEvent,
  deriveMemberQualificationProjection,
  normalizePersistedQualificationLifecycleEvent,
} from './qualification-lifecycle.js';

export class DepartmentPeopleError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 = 409,
  ) {
    super(code);
    this.name = 'DepartmentPeopleError';
  }
}

export interface DepartmentPeopleQuery {
  asOf: string;
  page: number;
  pageSize: number;
  search: string;
  employmentStatus?: DepartmentEmploymentStatus;
}

type ServiceRow = Omit<DepartmentPerson['serviceRecord'], 'basis'> & { id: number };

async function loadPeople(db: D1Database, asOf: string) {
  if (!isIsoCalendarDate(asOf)) throw new DepartmentPeopleError('invalid_as_of', 400);
  const [personnel, roster, services] = await Promise.all([
    loadDepartmentPersonnel(db, asOf),
    loadDepartmentRosterProjection(db, asOf, []),
    db
      .prepare(`SELECT id, NULLIF(rsc_seniority, 0) AS rscSeniority,
      rank_seniority AS rankSeniority, hired_at AS hiredAt, promoted_at AS promotedAt
      FROM members`)
      .all<ServiceRow>(),
  ]);
  if (!roster.ok) throw new DepartmentPeopleError(roster.error);
  const byId = new Map(services.results.map((row) => [row.id, row]));
  const assignmentsByMember = new Map<number, DepartmentPerson['assignments']>();
  for (const position of roster.projection.positions) {
    if (position.assignment === null) continue;
    const assignments = assignmentsByMember.get(position.assignment.memberId) ?? [];
    assignments.push(position);
    assignmentsByMember.set(position.assignment.memberId, assignments);
  }
  const people: DepartmentPerson[] = personnel.map((member) => {
    const service = byId.get(member.id);
    if (service === undefined) throw new DepartmentPeopleError('department_member_record_changed');
    const { id: _id, ...record } = service;
    return {
      id: member.id,
      employeeId: member.employeeId,
      firstName: member.firstName,
      lastName: member.lastName,
      rank: member.rank === 'CIVILIAN' ? null : member.rank,
      personnelClassification: member.rank === 'CIVILIAN' ? 'CIVILIAN' : 'SWORN',
      employmentStatus: member.employmentStatus,
      employmentStatusEffectiveOn: member.employmentStatusEffectiveOn,
      separationType: member.separationType,
      hasAssignment: member.hasAssignment,
      assignments: assignmentsByMember.get(member.id) ?? [],
      serviceRecord: { basis: 'current_member_record', ...record },
    };
  });
  return { asOf, updatedAt: roster.projection.updatedAt, people };
}

export async function loadDepartmentPeople(
  db: D1Database,
  query: DepartmentPeopleQuery,
): Promise<DepartmentPeopleListResponse> {
  if (!Number.isSafeInteger(query.page) || query.page < 1)
    throw new DepartmentPeopleError('invalid_page', 400);
  if (!Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 200)
    throw new DepartmentPeopleError('invalid_page_size', 400);
  if (query.search.length > 128) throw new DepartmentPeopleError('invalid_search', 400);
  const projection = await loadPeople(db, query.asOf);
  const search = query.search.trim().toLocaleLowerCase('en-US');
  const matching = projection.people.filter((person) => {
    if (query.employmentStatus !== undefined && person.employmentStatus !== query.employmentStatus)
      return false;
    if (!search) return true;
    return [
      person.employeeId,
      String(person.id),
      `${person.firstName} ${person.lastName}`,
      `${person.lastName}, ${person.firstName}`,
    ].some((value) => value.toLocaleLowerCase('en-US').includes(search));
  });
  const total = matching.length;
  const totalPages = Math.ceil(total / query.pageSize);
  const offset = (query.page - 1) * query.pageSize;
  return {
    asOf: projection.asOf,
    updatedAt: projection.updatedAt,
    updatedAtScope: 'department_roster_sources',
    people: matching.slice(offset, offset + query.pageSize),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1 && totalPages > 0,
    },
  };
}

function evidenceObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    // Evidence corruption is visible; never replace it with an empty history.
  }
  throw new DepartmentPeopleError('department_history_data_invalid');
}

type PersonnelHistory = DepartmentPersonDetailResponse['history']['personnelEvents'][number];
type PersonnelHistoryRow = Omit<PersonnelHistory, 'beforeState' | 'afterState'> & {
  beforeState: string;
  afterState: string;
};

export async function loadDepartmentPerson(
  db: D1Database,
  memberId: number,
  asOf: string,
): Promise<DepartmentPersonDetailResponse> {
  if (!Number.isSafeInteger(memberId) || memberId < 1)
    throw new DepartmentPeopleError('invalid_member_id', 400);
  const projection = await loadPeople(db, asOf);
  const person = projection.people.find((member) => member.id === memberId);
  if (person === undefined) throw new DepartmentPeopleError('member_not_found', 404);
  const [personnel, assignments, legacy, qualifications, catalogNames] = await Promise.all([
    db
      .prepare(`SELECT id, member_id AS memberId, staffing_position_id AS staffingPositionId,
      member_assignment_id AS memberAssignmentId, kind, effective_on AS effectiveOn,
      employment_status_before AS employmentStatusBefore, employment_status_after AS employmentStatusAfter,
      rank_before AS rankBefore, rank_after AS rankAfter, separation_type AS separationType,
      reason, origin, actor_subject AS actorSubject, idempotency_key AS idempotencyKey,
      before_state AS beforeState, after_state AS afterState,
      supersedes_event_id AS supersedesEventId, created_at AS createdAt
      FROM personnel_lifecycle_events WHERE member_id = ?
      ORDER BY effective_on DESC, created_at DESC, id DESC`)
      .bind(memberId)
      .all<PersonnelHistoryRow>(),
    db
      .prepare(`SELECT id, member_id AS memberId, staffing_position_id AS staffingPositionId,
      origin_type AS originType, origin_ref AS originRef, source_observation_id AS sourceObservationId,
      status, effective_from AS effectiveFrom, effective_to AS effectiveTo,
      created_at AS createdAt, updated_at AS updatedAt
      FROM member_assignments WHERE member_id = ?
      ORDER BY effective_from DESC, created_at DESC, id DESC`)
      .bind(memberId)
      .all<DepartmentPersonDetailResponse['history']['assignments'][number]>(),
    db
      .prepare(`SELECT member_credential.member_id AS memberId, member_credential.credential_id AS credentialId,
      credential.name AS credentialName, member_credential.start_date AS startDate,
      member_credential.expiration_date AS expirationDate
      FROM member_credentials member_credential
      JOIN credentials credential ON credential.id = member_credential.credential_id
      WHERE member_credential.member_id = ?`)
      .bind(memberId)
      .all<LegacyCredentialBaseline>(),
    db
      .prepare(`SELECT event.id, event.member_id AS memberId, event.credential_id AS credentialId,
      credential.name AS credentialName, event.specialty_code AS specialtyCode,
      event.specialty_terminal_status AS specialtyTerminalStatus, event.kind,
      event.effective_on AS effectiveOn, event.expires_on AS expiresOn,
      event.evidence_source AS evidenceSource, event.evidence_reference AS evidenceReference,
      event.reason, event.actor_subject AS actorSubject, event.idempotency_key AS idempotencyKey,
      event.before_state AS beforeState, event.after_state AS afterState, event.created_at AS createdAt
      FROM member_qualification_events event
      LEFT JOIN credentials credential ON credential.id = event.credential_id
      WHERE event.member_id = ? ORDER BY event.effective_on, event.created_at, event.id`)
      .bind(memberId)
      .all<PersistedQualificationLifecycleEvent>(),
    db
      .prepare(`SELECT credential_id AS credentialId, display_name AS displayName
      FROM credential_catalog_metadata`)
      .all<{ credentialId: number; displayName: string | null }>(),
  ]);
  const events: QualificationLifecycleEvent[] = [];
  for (const row of qualifications.results) {
    const normalized = normalizePersistedQualificationLifecycleEvent(row);
    if (normalized === null)
      throw new DepartmentPeopleError('qualification_lifecycle_data_invalid');
    events.push(normalized);
  }
  // Display metadata is current catalog context, never a changed source identity
  // supplied to the qualification evaluator or written into immutable evidence.
  const displayNames = new Map(
    catalogNames.results.map((row) => [row.credentialId, row.displayName]),
  );
  const effectiveQualifications = deriveMemberQualificationProjection({
    memberId,
    asOf,
    legacyCredentials: legacy.results,
    events,
  });
  return {
    asOf,
    updatedAt: projection.updatedAt,
    updatedAtScope: 'department_roster_sources',
    person,
    qualifications: {
      ...effectiveQualifications,
      certifications: effectiveQualifications.certifications.map((credential) => ({
        ...credential,
        credentialName: displayNames.get(credential.credentialId) ?? credential.credentialName,
      })),
    },
    history: {
      personnelEvents: personnel.results.map((event) => ({
        ...event,
        beforeState: evidenceObject(event.beforeState),
        afterState: evidenceObject(event.afterState),
      })),
      assignments: assignments.results,
      qualificationEvents: events.map((event) => ({
        ...event,
        credentialName:
          event.credentialId === null
            ? event.credentialName
            : (displayNames.get(event.credentialId) ?? event.credentialName),
        beforeState: evidenceObject(event.beforeState),
        afterState: evidenceObject(event.afterState),
      })),
    },
  };
}
