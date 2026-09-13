export interface DepartmentRosterPosition {
  organization?: {
    organizationUnitId: string | null;
    stationId: string | null;
    unitId: string | null;
    groupId: string | null;
  };
  id: string;
  stableSlotKey: string;
  division: string | null;
  shift: string | null;
  station: string | null;
  unit: string | null;
  positionName: string | null;
  applicableRank: string | null;
  reviewStatus: 'draft' | 'approved' | 'retired';
  occupancy: 'occupied' | 'vacant';
  temporaryContext: Array<{
    id: string;
    kind: 'SPECIAL_ASSIGNMENT' | 'LIGHT_DUTY';
    effectiveOn: string;
    plannedEndOn: string | null;
    actualEndOn: string | null;
  }>;
  assignment: {
    id: string;
    memberId: number;
    originType: string | null;
    status: string | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  } | null;
  member: {
    id: number;
    employeeId: string | null;
    firstName: string | null;
    lastName: string | null;
    rank: string | null;
  } | null;
}

export interface DepartmentRosterProjection {
  organizationUnits?: Array<{
    id: string;
    kind: 'STATION' | 'GROUP' | 'APPARATUS';
    name: string;
    parentId: string | null;
    status: 'active' | 'retired';
    effectiveOn: string;
    revision: number;
  }>;
  asOf: string;
  updatedAt: number | null;
  positions: DepartmentRosterPosition[];
  summary: {
    totalPositions: number;
    occupiedPositions: number;
    vacantPositions: number;
  };
  unassignedMembers: Array<{
    id: number;
    employeeId: string;
    firstName: string;
    lastName: string;
    rank: string;
  }>;
}
