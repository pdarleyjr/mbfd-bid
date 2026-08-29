import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PersonnelWorkspace } from '../../app/admin/personnel/PersonnelWorkspace';

describe('PersonnelWorkspace', () => {
  it('makes synthetic roster state, unclassified legacy members, and the append-only change workflow visible', () => {
    const html = renderToString(
      <PersonnelWorkspace
        summary={{
          asOf: '2026-08-28',
          members: { active: 1, inactive: 0, retired: 0, separated: 0, unclassified: 1 },
          activeAssignments: 1,
          upcomingChanges: 1,
        }}
        members={[
          {
            id: 1,
            employeeId: 'synthetic-001',
            firstName: 'Synthetic',
            lastName: 'Firefighter',
            rank: 'FF',
            employmentStatus: 'active',
            employmentStatusEffectiveOn: '2026-01-01',
            separationType: null,
          },
          {
            id: 2,
            employeeId: 'synthetic-legacy',
            firstName: 'Legacy',
            lastName: 'Unclassified',
            rank: 'FF',
            employmentStatus: 'unknown',
            employmentStatusEffectiveOn: null,
            separationType: null,
          },
        ]}
      />,
    );

    expect(html).toContain('Personnel lifecycle');
    expect(html).toContain('Synthetic');
    expect(html).toContain('Firefighter');
    expect(html).toContain('Needs classification');
    expect(html).toContain('New hire / reactivation');
    expect(html).toContain('No historical member or assignment is deleted');
    expect(html).toContain('data-testid="personnel-change-form"');
  });

  it('uses a member and assignment query hint to orient an operator in history', () => {
    const html = renderToString(
      <PersonnelWorkspace
        summary={{
          asOf: '2026-08-28',
          members: { active: 1, inactive: 0, retired: 0, separated: 0, unclassified: 0 },
          activeAssignments: 1,
          upcomingChanges: 0,
        }}
        members={[
          {
            id: 1,
            employeeId: 'synthetic-001',
            firstName: 'Synthetic',
            lastName: 'Firefighter',
            rank: 'FF',
            employmentStatus: 'active',
            employmentStatusEffectiveOn: '2026-01-01',
            separationType: null,
          },
          {
            id: 2,
            employeeId: 'synthetic-002',
            firstName: 'Linked',
            lastName: 'Member',
            rank: 'LT',
            employmentStatus: 'active',
            employmentStatusEffectiveOn: '2026-01-01',
            separationType: null,
          },
        ]}
        memberIdHint={2}
        assignmentIdHint="assignment-linked"
      />,
    );

    expect(html).toContain('data-testid="personnel-link-context"');
    expect(html).toContain('assignment-linked');
    expect(html).toContain('<option value="2" selected="">');
  });
});
