export interface DepartmentRetirementBlocker {
  code: string;
  recordId: string;
  detail: string;
}

export type DepartmentRetirementTarget =
  | {
      kind: 'POSITION';
      id: string;
      name: string;
      stableSlotKey: string;
      authorization: {
        reviewStatus: 'draft' | 'approved' | 'retired';
        activeFrom: string | null;
        activeTo: string | null;
        updatedAt: number;
      };
    }
  | {
      kind: 'STATION' | 'GROUP' | 'APPARATUS';
      id: string;
      name: string;
      authorization: {
        status: 'active' | 'retired';
        revision: number;
        effectiveOn: string;
        parentId: string | null;
      };
    };

export interface DepartmentRetirementAssignment {
  id: string;
  staffingPositionId: string;
  memberId: number;
  firstName: string;
  lastName: string;
  status: 'planned' | 'active' | 'ended' | 'superseded' | 'cancelled';
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Date relationship only; status remains explicit, including cancelled history. */
  timing: 'before_date' | 'covers_date' | 'future';
}

export interface DepartmentRetirementOrganizationVersion {
  id: string;
  kind: 'STATION' | 'GROUP' | 'APPARATUS';
  name: string;
  revision: number;
  parentId: string | null;
  status: 'active' | 'retired';
  effectiveOn: string;
  nextEffectiveOn: string | null;
  evidenceRef: string;
}

export interface DepartmentRetirementOrganizationLink {
  staffingPositionId: string;
  stableSlotKey: string;
  organizationUnitId: string | null;
  revision: number;
  effectiveOn: string;
  nextEffectiveOn: string | null;
  evidenceRef: string;
}

export interface DepartmentRetirementImpact {
  target: DepartmentRetirementTarget;
  effectiveOn: string;
  /** Position authorization ends inclusively on the preceding day. */
  lastActiveOn: string | null;
  retirementBlocked: boolean;
  blockers: DepartmentRetirementBlocker[];
  assignments: DepartmentRetirementAssignment[];
  organizationVersions: DepartmentRetirementOrganizationVersion[];
  organizationLinks: DepartmentRetirementOrganizationLink[];
  retainsHistory: true;
}
