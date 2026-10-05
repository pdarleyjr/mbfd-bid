import { describe, expect, it } from 'vitest';
import { buildShiftRoster } from '../../src/exports/shift-roster.js';
import { renderShiftViewHtml } from '../../src/exports/shift-view-pdf.js';
import { projectFrozenNonBidAssignments } from '../../src/lib/frozen-nonbid-assignments.js';
import { shiftExportFixture } from './helpers/shift-roster-fixture.js';

function fixture() {
  const input = shiftExportFixture();
  const baseMember = input.snapshot.members[0];
  const basePosition = input.snapshot.ruleBookMaterial.positions[0];
  if (!baseMember || !basePosition) throw new Error('fixture material missing');
  const seats = ['A211', 'B211', 'C211', 'A801', 'D201', 'D301', 'D401', 'D402'];
  seats.forEach((id, index) => {
    const memberId = index + 10;
    const rank = index < 3 ? 'DC' : index < 6 ? 'CPT' : 'LT';
    input.snapshot.members.push({
      ...baseMember,
      memberId,
      pool: 'EXCLUDED',
      exclusionReason: 'ADMIN_ASSIGNED_NON_BIDDABLE',
      authoritativeAssignmentId: `retained-assignment-${memberId}`,
      rank,
      currentBidPositionIds: [id],
    });
    input.snapshot.operatorIdentityProjection?.push({
      memberId,
      employeeId: `PRIVATE_FIXED_EMPLOYEE_${memberId}`,
      firstName: `Retained ${index}`,
      lastName: 'Assigned',
      rank,
    });
    input.snapshot.ruleBookMaterial.positions.push({
      ...basePosition,
      id,
      shift: id.startsWith('D') ? 'D' : id.startsWith('B') ? 'B' : id.startsWith('C') ? 'C' : 'A',
      bidParticipation: index < 4 ? 'ADMIN_ASSIGNED_NON_BIDDABLE' : 'RESERVED_NON_BIDDABLE',
      rankRequired: rank,
      positionName: index < 3 ? 'Division Chief' : index < 6 ? 'Captain' : 'Lieutenant',
      unit: index < 3 ? '300' : 'Retained Unit',
      isExcludedFromCount: index >= 3,
    });
  });
  return input;
}

describe('read-only frozen nonbiddable assignments', () => {
  it('projects all eight fixed names and never exposes private identity or qualifications', () => {
    const input = fixture();
    const assignments = projectFrozenNonBidAssignments(input.snapshot);
    expect([...assignments.keys()]).toEqual([
      'A211',
      'B211',
      'C211',
      'A801',
      'D201',
      'D301',
      'D401',
      'D402',
    ]);
    expect(assignments.get('D402')).toEqual({
      memberId: 17,
      name: 'Retained 7 Assigned',
      rank: 'LT',
    });
    expect(JSON.stringify([...assignments])).not.toMatch(/PRIVATE_FIXED|credential|employee/i);
  });

  it('does not prepopulate a biddable current seat or historical identity', () => {
    const input = fixture();
    const bidder = input.snapshot.members[0];
    if (!bidder) throw new Error('bidder missing');
    bidder.currentBidPositionIds = ['A102'];
    expect(projectFrozenNonBidAssignments(input.snapshot).has('A102')).toBe(false);
    expect(projectFrozenNonBidAssignments(input.snapshot).has('A101')).toBe(false);
  });

  it('omits ambiguous seats and members with multiple fixed assignments', () => {
    const input = fixture();
    const other = input.snapshot.members[0];
    if (!other) throw new Error('bidder missing');
    other.currentBidPositionIds = ['A211'];
    expect(projectFrozenNonBidAssignments(input.snapshot).has('A211')).toBe(false);
    const fixed = input.snapshot.members.find((member) => member.memberId === 11);
    if (!fixed) throw new Error('fixed member missing');
    fixed.currentBidPositionIds = ['B211', 'C211'];
    const map = projectFrozenNonBidAssignments(input.snapshot);
    expect(map.has('B211')).toBe(false);
    expect(map.has('C211')).toBe(false); // Conflicting multi-seat evidence remains ambiguous.
  });

  it('does not invent a name for missing or ambiguous frozen identity', () => {
    const input = fixture();
    input.snapshot.operatorIdentityProjection = input.snapshot.operatorIdentityProjection?.filter(
      (identity) => identity.memberId !== 10,
    );
    const duplicate = input.snapshot.operatorIdentityProjection?.find(
      (identity) => identity.memberId === 11,
    );
    if (!duplicate) throw new Error('identity missing');
    input.snapshot.operatorIdentityProjection?.push({ ...duplicate });
    const map = projectFrozenNonBidAssignments(input.snapshot);
    expect(map.has('A211')).toBe(false);
    expect(map.has('B211')).toBe(false);
    expect(map.size).toBe(6);
  });

  it('keeps older snapshots with no retained placement evidence unchanged', () => {
    expect(projectFrozenNonBidAssignments(shiftExportFixture().snapshot).size).toBe(0);
  });

  it('exports all eight fixed names without creating awards or changing saved selections', () => {
    const input = fixture();
    const before = JSON.stringify({ snapshot: input.snapshot, state: input.state });
    const roster = buildShiftRoster(input);
    const rows = roster.shifts.flatMap((shift) =>
      shift.stations.flatMap((station) => station.rows),
    );
    const fixed = rows.filter((row) => row.administrativeAssignment);
    expect(fixed).toHaveLength(8);
    expect(
      fixed.every((row) => row.member?.startsWith('Retained ') && row.status === 'Not biddable'),
    ).toBe(true);
    expect(roster.shifts.reduce((count, shift) => count + shift.selected, 0)).toBe(2);
    expect(roster.shifts.reduce((count, shift) => count + shift.available, 0)).toBe(2);
    expect(rows.find((row) => row.positionId === 'A101')).toMatchObject({
      member: 'Frozen <Captain> Member & Saved',
      aDay: 'Deferred',
      status: 'Selected',
    });
    expect(JSON.stringify({ snapshot: input.snapshot, state: input.state })).toBe(before);
    const html = renderShiftViewHtml(roster);
    expect(html).toContain('Retained 7 Assigned');
    expect(html).not.toContain('PRIVATE_FIXED_EMPLOYEE');
  });
});
