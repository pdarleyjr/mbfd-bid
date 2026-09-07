import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AdminQueryProvider } from '../../app/admin/_components/AdminQueryProvider';
import { StaffingStructureWorkspace as StaffingComponent } from '../../app/admin/staffing-structure/StaffingStructureWorkspace';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
function StaffingStructureWorkspace(props: React.ComponentProps<typeof StaffingComponent>) {
  return (
    <AdminQueryProvider>
      <StaffingComponent {...props} />
    </AdminQueryProvider>
  );
}

describe('StaffingStructureWorkspace', () => {
  it('gives an administrator an effective-dated authorized-seat workflow without confusing vacancy and Bid opportunity', () => {
    const html = renderToStaticMarkup(
      <StaffingStructureWorkspace
        roster={{
          asOf: '2026-09-03',
          administrativeAssignmentPolicy: {
            status: 'unconfigured',
            bidYear: 2026,
            ruleBookVersion: null,
          },
          positions: [
            {
              id: 'staffing-synthetic-1',
              stableSlotKey: 'A/1/ENGINE-1/FIREFIGHTER/1',
              division: 'Suppression',
              shift: 'A',
              station: '1',
              unit: 'Engine 1',
              positionName: 'Firefighter',
              applicableRank: 'FF',
              occupancy: 'vacant',
              administrativeAssignment: false,
              assignment: null,
              member: null,
            },
          ],
          summary: {
            totalPositions: 1,
            occupiedPositions: 0,
            vacantPositions: 1,
            administrativelyAssignedNonBiddablePositions: 0,
          },
          unassignedMembers: [],
        }}
      />,
    );

    expect(html).toContain('Staffing Structure');
    expect(html).toContain('Add authorized staffing seat');
    expect(html).toContain('Reviewable canonical key');
    expect(html).toContain('Create authorized seat');
    expect(html).toContain('Retire seat');
    expect(html).toContain('Move or reassign a member');
    expect(html).toContain('never labelled a Bid opportunity');
    expect(html).toContain('Projection date');
    expect(html).toContain('name="as_of"');
    expect(html).toContain('View projection');
  });
});
