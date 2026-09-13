import type { DepartmentRosterPosition } from './department-roster.js';

export type DepartmentEmploymentStatus =
  | 'unknown'
  | 'active'
  | 'inactive'
  | 'retired'
  | 'separated';

export interface DepartmentPerson {
  id: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  rank: string | null;
  personnelClassification: 'SWORN' | 'CIVILIAN';
  employmentStatus: DepartmentEmploymentStatus;
  employmentStatusEffectiveOn: string | null;
  separationType: string | null;
  hasAssignment: boolean;
  assignments: DepartmentRosterPosition[];
  /** These source fields are not a reconstructed historical service record. */
  serviceRecord: {
    basis: 'current_member_record';
    rscSeniority: number | null;
    rankSeniority: number | null;
    hiredAt: string | null;
    promotedAt: string | null;
  };
}

export interface DepartmentPeopleListResponse {
  asOf: string;
  /** Department roster source recency; legacy credentials have no recorded timestamp. */
  updatedAt: number | null;
  updatedAtScope: 'department_roster_sources';
  people: DepartmentPerson[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface DepartmentQualificationEvidence {
  id: string;
  memberId: number;
  credentialId: number | null;
  credentialName: string | null;
  specialtyCode: string | null;
  kind: string;
  effectiveOn: string;
  expiresOn: string | null;
  evidenceSource: string;
  evidenceReference: string | null;
  reason: string;
  actorSubject: string;
  idempotencyKey: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  createdAt: number;
}

export interface DepartmentPersonDetailResponse {
  asOf: string;
  /** Department roster source recency; excludes qualification and legacy credential edits. */
  updatedAt: number | null;
  updatedAtScope: 'department_roster_sources';
  person: DepartmentPerson;
  qualifications: {
    certifications: Array<{
      credentialId: number;
      credentialName: string | null;
      status: 'active' | 'expired' | 'revoked';
      effectiveOn: string | null;
      expiresOn: string | null;
      evidenceSource: string | null;
      evidenceReference: string | null;
      eventId: string | null;
      origin: 'lifecycle_evidence' | 'legacy_projection';
    }>;
    specialties: Array<{
      specialtyCode: string;
      status: 'active' | 'expired' | 'revoked' | 'removed';
      effectiveOn: string;
      expiresOn: string | null;
      evidenceSource: string;
      evidenceReference: string | null;
      eventId: string;
    }>;
  };
  history: {
    /** Entire dated ledger, including scheduled events after the selected date. */
    personnelEvents: Array<{
      id: string;
      memberId: number;
      staffingPositionId: string | null;
      memberAssignmentId: string | null;
      kind: string;
      effectiveOn: string;
      employmentStatusBefore: string | null;
      employmentStatusAfter: string | null;
      rankBefore: string | null;
      rankAfter: string | null;
      separationType: string | null;
      reason: string;
      origin: string;
      actorSubject: string;
      idempotencyKey: string;
      beforeState: Record<string, unknown>;
      afterState: Record<string, unknown>;
      supersedesEventId: string | null;
      createdAt: number;
    }>;
    assignments: Array<{
      id: string;
      memberId: number;
      staffingPositionId: string;
      originType: string;
      originRef: string;
      sourceObservationId: string | null;
      status: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      createdAt: number;
      updatedAt: number;
    }>;
    qualificationEvents: DepartmentQualificationEvidence[];
  };
}
