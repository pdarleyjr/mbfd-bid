// @vitest-environment jsdom
import { type ReactNode, act, useEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberLite } from '../../app/_components/bid/types';
import { AnnualLiveControls } from '../../app/admin/bid/_components/AnnualLiveControls';
import {
  BidOperatorProvider,
  useBidOperator,
} from '../../app/admin/bid/_components/BidOperatorContext';
import { BidOperatorWorkspace } from '../../app/admin/bid/_components/BidOperatorWorkspace';
import type { OperatorSpecialtyRoster } from '../../app/admin/bid/_components/operator-specialty-roster';

vi.mock('../../app/admin/bid/_components/BidMemberPanel', () => ({
  BidMemberPanel: ({ member }: { member: MemberLite }) => (
    <div aria-label="Selected member details">{member.firstName}</div>
  ),
}));
vi.mock('../../app/admin/bid/_components/CorrectBid', () => ({ CorrectBid: () => null }));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const members: Record<string, MemberLite> = Object.fromEntries(
  [1, 2, 3, 4].map((id) => [
    String(id),
    {
      id,
      firstName: `Member${id}`,
      lastName: 'Synthetic',
      employeeId: String(1000 + id),
      rank: 'FF',
    },
  ]),
);
const order = [1, 2, 3, 4].map((memberId) => ({ memberId }));
const fills = { A002: { memberId: 2, ordinal: 2, bidId: 'synthetic-picked' } };
function roster(): OperatorSpecialtyRoster {
  return {
    sessionId: 'specialty-fixture',
    sequence: 4,
    availability: 'AVAILABLE',
    combinedShortage: 1,
    groups: [
      {
        id: 'driver',
        label: 'Driver Engineer',
        positionIds: ['A103', 'B103'],
        candidates: [
          {
            memberId: 3,
            priority: 1,
            points: 8,
            available: true,
            eligiblePositionIds: ['A103', 'B103'],
          },
          {
            memberId: 2,
            priority: 2,
            points: 7,
            available: false,
            eligiblePositionIds: ['A103', 'B103'],
          },
          {
            memberId: 1,
            priority: 3,
            points: 0,
            available: true,
            eligiblePositionIds: ['A103', 'B103'],
          },
        ],
        remainingSeatCount: 2,
        eligibleMemberCount: 2,
        status: 'LOW_BUFFER',
        criticalMemberIds: [3],
        rankingAvailable: true,
        dataBlockedMemberIds: [],
      },
      {
        id: 'air',
        label: 'Air Tech 810',
        positionIds: ['A203'],
        candidates: [],
        remainingSeatCount: 1,
        eligibleMemberCount: 0,
        status: 'SHORTAGE',
        criticalMemberIds: [],
        rankingAvailable: true,
        dataBlockedMemberIds: [],
      },
      {
        id: 'trt',
        label: 'TRT membership',
        positionIds: [],
        candidates: [
          { memberId: 3, priority: null, points: null, available: true, eligiblePositionIds: [] },
        ],
        remainingSeatCount: null,
        eligibleMemberCount: 1,
        status: null,
        criticalMemberIds: [],
        rankingAvailable: false,
        dataBlockedMemberIds: [],
      },
      {
        id: 'trt-certificates',
        label: 'TRT · Operations certificates',
        certificateInventory: {
          credentialNames: [
            'Hazardous Materials Operations',
            'Rope Rescue Operations',
            'Vehicle & Machinery Rescue Operations',
            'Confined Space Operations',
            'Structural Collapse Operations',
            'Trench Rescue Operations',
          ],
        },
        positionIds: [],
        candidates: [
          { memberId: 3, priority: null, points: null, available: true, eligiblePositionIds: [] },
          { memberId: 2, priority: null, points: null, available: false, eligiblePositionIds: [] },
        ],
        remainingSeatCount: null,
        eligibleMemberCount: 1,
        status: null,
        criticalMemberIds: [],
        rankingAvailable: false,
        dataBlockedMemberIds: [],
      },
    ],
  };
}
function Publish({ value }: { value: OperatorSpecialtyRoster }) {
  const operator = useBidOperator();
  useEffect(() => operator?.setSpecialtyRoster(value), [operator?.setSpecialtyRoster, value]);
  useEffect(
    () =>
      operator?.setADayProjection({
        sessionId: value.sessionId,
        sequence: value.sequence,
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        maximumPerGroup: null,
        fills: { A002: { member_id: 2, a_day: 'G2' } },
      }),
    [operator?.setADayProjection, value.sessionId, value.sequence],
  );
  return <output data-testid="selected-member">{operator?.selectedMemberId}</output>;
}
function Workspace({
  minimumSequence = 0,
  currentFills = fills,
}: {
  minimumSequence?: number;
  currentFills?: Record<string, { memberId: number; ordinal: number; bidId: string }>;
}) {
  return (
    <BidOperatorWorkspace
      sessionId="specialty-fixture"
      minimumSequence={minimumSequence}
      members={members}
      bidOrder={order}
      fills={currentFills}
      temporarilyAssignedMemberIds={[4]}
    >
      <div>Seat board</div>
    </BidOperatorWorkspace>
  );
}
let root: Root;
let host: HTMLDivElement;
let originalWindowFetch: typeof fetch;
beforeEach(() => {
  originalWindowFetch = window.fetch;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const fetcher = vi.fn(async () => {
    throw new Error('No roster network requests expected');
  });
  vi.stubGlobal('fetch', fetcher);
  window.fetch = fetcher;
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.fetch = originalWindowFetch;
});
async function mount(children: ReactNode, projection = roster()) {
  await act(async () => {
    root.render(
      <BidOperatorProvider currentBidderId={1}>
        <Publish value={projection} />
        {children}
      </BidOperatorProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function clickText(text: string) {
  const button = [...host.querySelectorAll('button')].find(
    (entry) => entry.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Missing ${text}`);
  await act(() => button.click());
}
async function setSelect(label: string, value: string) {
  const select = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement | null;
  if (!select) throw new Error(`Missing ${label}`);
  await act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const specialtyMemberIds = () =>
  [...host.querySelectorAll('[data-testid^="operator-member-specialty-"]')].map((node) =>
    node.getAttribute('data-testid'),
  );

function ObserveBoardSequence({ sequence }: { sequence: number }) {
  const operator = useBidOperator();
  useEffect(
    () => operator?.observeBoardSequence(sequence),
    [operator?.observeBoardSequence, sequence],
  );
  return null;
}

describe('specialty roster display', () => {
  it('defaults to seniority with the same deduplicated remaining members and no extra fetch', async () => {
    await mount(<Workspace />);
    expect(
      [...host.querySelectorAll('[data-testid^="operator-member-remaining-"]')].map((node) =>
        node.getAttribute('data-testid'),
      ),
    ).toEqual(['operator-member-remaining-1', 'operator-member-remaining-3']);
    expect(host.querySelector('select[aria-label="Specialty roster"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('shows the server priority order and points without granting eligibility or re-sorting by seniority', async () => {
    await mount(<Workspace minimumSequence={4} />);
    await clickText('Specialty');
    expect(specialtyMemberIds()).toEqual([
      'operator-member-specialty-3',
      'operator-member-specialty-1',
    ]);
    expect(
      host.querySelector('[data-testid="operator-member-specialty-3"]')?.textContent,
    ).toContain('8 points');
    expect(
      host.querySelector('[data-testid="operator-member-specialty-3"]')?.textContent,
    ).toContain('Needed for coverage');
    expect(host.querySelector('[data-testid="operator-member-specialty-4"]')).toBeNull();
    expect(
      host
        .querySelector('[data-testid="operator-member-specialty-3"]')
        ?.getAttribute('data-priority'),
    ).toBe('1');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('filters remaining, already bid and all qualified independently and preserves click-member details', async () => {
    await mount(<Workspace />);
    await clickText('Specialty');
    await setSelect('Specialty member status', 'taken');
    expect(specialtyMemberIds()).toEqual(['operator-member-specialty-2']);
    await act(() =>
      (
        host.querySelector('[data-testid="operator-member-specialty-2"]') as HTMLButtonElement
      ).click(),
    );
    expect(host.querySelector('[aria-label="Selected member details"]')?.textContent).toBe(
      'Member2',
    );
    expect(host.querySelector('[data-testid="selected-member"]')?.textContent).toBe('2');
    await setSelect('Specialty member status', 'all');
    expect(specialtyMemberIds()).toEqual([
      'operator-member-specialty-3',
      'operator-member-specialty-2',
      'operator-member-specialty-1',
    ]);
  });
  it('opens the relevant qualified roster from compact staffing warnings and keeps overlap shortage explicit', async () => {
    await mount(<Workspace />);
    const alerts = host.querySelector('[aria-label="Staffing alerts"]');
    expect(alerts?.textContent).toContain('2 specialties need attention');
    expect(alerts?.textContent).toContain('0 qualified / 1 open · Shortage');
    expect(alerts?.textContent).toContain('across overlapping specialties');
    if (!alerts) throw new Error('Staffing alerts required');
    const button = [...alerts.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('Air Tech 810'),
    );
    await act(() => button?.click());
    const selector = host.querySelector(
      'select[aria-label="Specialty roster"]',
    ) as HTMLSelectElement | null;
    expect(selector?.value).toBe('air');
    expect(
      host.querySelector('[aria-controls="operator-remaining"]')?.getAttribute('aria-expanded'),
    ).toBe('true');
  });
  it('labels reviewed membership pools without manufacturing rank or points', async () => {
    await mount(<Workspace />);
    await clickText('Specialty');
    await setSelect('Specialty roster', 'trt');
    const member = host.querySelector('[data-testid="operator-member-specialty-3"]');
    expect(member?.textContent).toContain('Qualified pool');
    expect(member?.textContent).not.toContain('points');
    expect(member?.getAttribute('data-priority')).toBe('unavailable');
  });
  it('labels the TRT certificate inventory without claiming priority, seat capacity or membership and keeps filters and details usable', async () => {
    await mount(<Workspace />);
    await clickText('Specialty');
    await setSelect('Specialty roster', 'trt-certificates');
    expect(host.textContent).toContain('Certificate inventory · 1 remaining');
    expect(host.textContent).toContain(
      'Six Operations certificates on record. Eligibility is checked on selection.',
    );
    const member = host.querySelector('[data-testid="operator-member-specialty-3"]');
    expect(member?.textContent).toContain('Operations certificates');
    expect(member?.textContent).not.toMatch(/Qualified pool|points|TRT membership/);
    expect(member?.getAttribute('data-priority')).toBe('unavailable');
    const summary = [...host.querySelectorAll('p')].find((node) =>
      node.textContent?.includes('Certificate inventory'),
    );
    expect(summary?.textContent).not.toMatch(/Priority|open seats/);
    expect(host.querySelector('option[value="all"]')?.textContent).toBe('All certificate holders');
    await setSelect('Specialty member status', 'taken');
    expect(specialtyMemberIds()).toEqual(['operator-member-specialty-2']);
    await act(() =>
      (
        host.querySelector('[data-testid="operator-member-specialty-2"]') as HTMLButtonElement
      ).click(),
    );
    expect(host.querySelector('[aria-label="Selected member details"]')?.textContent).toBe(
      'Member2',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('starts with a useful fresh specialty group instead of the first empty list and preserves an explicit empty-list choice', async () => {
    const projection = roster();
    const empty = {
      ...projection.groups[0],
      id: 'empty-investigator',
      label: 'Fire Investigator preference',
      positionIds: ['A303'],
      candidates: [],
      remainingSeatCount: 0,
      eligibleMemberCount: 0,
    } as OperatorSpecialtyRoster['groups'][number];
    projection.groups = [empty, ...projection.groups];
    await mount(<Workspace minimumSequence={4} />, projection);
    await clickText('Specialty');
    const selector = host.querySelector(
      'select[aria-label="Specialty roster"]',
    ) as HTMLSelectElement | null;
    expect(selector?.value).toBe('driver');
    expect(specialtyMemberIds()).toEqual([
      'operator-member-specialty-3',
      'operator-member-specialty-1',
    ]);
    await setSelect('Specialty roster', 'empty-investigator');
    expect(selector?.value).toBe('empty-investigator');
    expect(specialtyMemberIds()).toEqual([]);
  });
  it('falls back to a fresh inventory with remaining certificate holders when no group has open seats', async () => {
    const projection = roster();
    projection.groups = projection.groups
      .filter((group) => group.id === 'driver' || group.id === 'trt-certificates')
      .map((group) =>
        group.id === 'driver' ? { ...group, remainingSeatCount: 0, eligibleMemberCount: 0 } : group,
      );
    await mount(<Workspace />, projection);
    await clickText('Specialty');
    expect(
      (host.querySelector('select[aria-label="Specialty roster"]') as HTMLSelectElement | null)
        ?.value,
    ).toBe('trt-certificates');
  });
  it('does not show a previous session specialty projection', async () => {
    await mount(<Workspace />, { ...roster(), sessionId: 'other-session' });
    await clickText('Specialty');
    expect(specialtyMemberIds()).toEqual([]);
    expect(host.textContent).toContain('Specialty lists are updating.');
    expect(host.querySelector('[aria-label="Staffing alerts"]')).toBeNull();
  });
  it('retains the newer server-rendered fill when the context still describes the previous sequence', async () => {
    await mount(
      <Workspace
        minimumSequence={5}
        currentFills={{ ...fills, A103: { memberId: 3, ordinal: 3, bidId: 'newer-ssr-selection' } }}
      />,
    );
    expect(host.querySelector('[data-testid="operator-member-picked-3"]')?.textContent).toContain(
      'A103',
    );
    expect(host.querySelector('[data-testid="operator-member-remaining-3"]')).toBeNull();
    await clickText('Specialty');
    expect(specialtyMemberIds()).toEqual([]);
    expect(host.textContent).toContain('Specialty lists are updating.');
    expect(host.querySelector('[aria-label="Staffing alerts"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses an older specialty and A-Day projection after a newer board websocket watermark', async () => {
    await mount(
      <>
        <ObserveBoardSequence sequence={5} />
        <Workspace
          currentFills={{
            ...fills,
            A103: { memberId: 3, ordinal: 3, bidId: 'newer-websocket-selection' },
          }}
        />
      </>,
    );
    expect(host.querySelector('[data-testid="operator-member-picked-3"]')?.textContent).toContain(
      'A103',
    );
    await clickText('Specialty');
    expect(specialtyMemberIds()).toEqual([]);
    expect(host.textContent).toContain('Specialty lists are updating.');
  });
});

describe.each([false, true])('canonical specialty publication (Mock=%s)', (isMock) => {
  it('publishes roster and A-Day data from the existing single read and updates recorded filters before parent props catch up', async () => {
    let sequence = 4;
    let currentFills = { A002: { member_id: 2, a_day: 'G2', forced: false } } as Record<
      string,
      { member_id: number; a_day: string; forced: boolean }
    >;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/admin/bid-session/specialty-fixture/specialty-live');
      const projection = roster();
      projection.sequence = sequence;
      if (sequence === 5)
        projection.groups = projection.groups.map((group) => ({
          ...group,
          candidates: group.candidates.map((candidate) => ({
            ...candidate,
            available: candidate.memberId === 3 ? false : candidate.available,
          })),
        }));
      return Response.json({
        sequence,
        current_bidder: { member_id: 1, first_name: 'Member1', last_name: 'Synthetic', rank: 'FF' },
        current_phase: 'position_bid',
        remaining_order: [1, 3],
        fills: currentFills,
        specialties: [],
        active: null,
        specialty_roster: projection,
        a_day_combat_groups: ['G1', 'G2', 'G3', 'G4'],
        a_day_maximum_per_group: 6,
      });
    });
    vi.stubGlobal('fetch', fetcher);
    window.fetch = fetcher;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await act(async () => {
      root.render(
        <BidOperatorProvider currentBidderId={1}>
          <AnnualLiveControls
            bidSessionId="specialty-fixture"
            isMock={isMock}
            currentBidderId={1}
            bidOrder={order}
            fills={fills}
            members={members}
            positions={[]}
            workspace
            board={<Workspace />}
          />
        </BidOperatorProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetcher).toHaveBeenCalledOnce();
    await clickText('Specialty');
    expect(specialtyMemberIds()).toEqual([
      'operator-member-specialty-3',
      'operator-member-specialty-1',
    ]);
    sequence = 5;
    currentFills = { ...currentFills, A103: { member_id: 3, a_day: 'G3', forced: true } };
    await act(async () => {
      vi.advanceTimersByTime(2500);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(specialtyMemberIds()).toEqual(['operator-member-specialty-1']);
    await setSelect('Specialty member status', 'taken');
    expect(specialtyMemberIds()).toEqual([
      'operator-member-specialty-3',
      'operator-member-specialty-2',
    ]);
    expect(host.querySelector('[data-testid="operator-member-picked-3"]')?.textContent).toContain(
      'A103',
    );
  });
});
