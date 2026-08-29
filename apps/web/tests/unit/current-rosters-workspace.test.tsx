import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CurrentRostersWorkspace } from '../../app/admin/current-rosters/CurrentRostersWorkspace';

const roster = {
  asOf: '2026-08-28',
  administrativeAssignmentPolicy: {
    status: 'configured' as const,
    bidYear: 2026,
    ruleBookVersion: '2026.synthetic',
  },
  positions: [
    {
      id: 'synthetic-a-1',
      stableSlotKey: 'SYNTHETIC/A/1/ENGINE',
      division: 'Suppression/Rescue',
      shift: 'A',
      station: '1',
      unit: 'Engine 1',
      positionName: 'Firefighter',
      applicableRank: 'FF',
      occupancy: 'occupied' as const,
      administrativeAssignment: false,
      assignment: {
        id: 'synthetic-assignment',
        memberId: 1,
        originType: 'ADMIN_TRANSFER',
        status: 'active',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
      member: {
        id: 1,
        employeeId: 'SYNTH-001',
        firstName: 'Synthetic',
        lastName: 'One',
        rank: 'FF',
      },
    },
    {
      id: 'synthetic-d-1',
      stableSlotKey: 'SYNTHETIC/D/1/CHIEF',
      division: 'Suppression/Rescue',
      shift: 'D',
      station: '1',
      unit: 'Days',
      positionName: 'Division Chief',
      applicableRank: 'DC',
      occupancy: 'vacant' as const,
      administrativeAssignment: true,
      assignment: null,
      member: null,
    },
  ],
  summary: {
    totalPositions: 2,
    occupiedPositions: 1,
    vacantPositions: 1,
    administrativelyAssignedNonBiddablePositions: 1,
  },
  unassignedMembers: [
    {
      id: 2,
      employeeId: 'SYNTH-002',
      firstName: 'Synthetic',
      lastName: 'Unassigned',
      rank: 'LT',
      bidCategory: 'OFC',
    },
  ],
};

describe('CurrentRostersWorkspace', () => {
  it('shows staffing capacity, occupancy, unassigned people, and administrative non-biddable status without calling a vacancy a bid opportunity', () => {
    const html = renderToString(<CurrentRostersWorkspace roster={roster} />);

    expect(html).toContain('Current Rosters');
    expect(html).toContain('Roster at a glance');
    expect(html).toContain('A Shift');
    expect(html).toContain('D / Days');
    expect(html).toContain('Engine 1');
    expect(html).toContain('Vacant');
    expect(html).toContain('Administratively assigned');
    expect(html).toContain('Unassigned members');
    expect(html).toContain('Synthetic');
    expect(html).toContain('Unassigned');
    expect(html).toContain('not a Bid opportunity');
    expect(html).toContain('View staffing date');
    expect(html).toContain('name="as_of"');
    expect(html).toContain('Download roster CSV');
    expect(html).toContain('/api/admin/current-roster/export.csv?as_of=2026-08-28');
    expect(html).toContain('effective');
    expect(html).toContain('2026-01-01');
    expect(html).toContain('onward');
    expect(html).toContain('Assignment history');
    expect(html).toContain('/admin/personnel?memberId=1&amp;assignmentId=synthetic-assignment');
  });
});
