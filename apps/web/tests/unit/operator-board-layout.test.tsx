// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberLite, PositionMeta } from '../../app/_components/bid/types';
import { AdminBidShell } from '../../app/admin/bid/_components/AdminBidShell';
import { AdminBoard } from '../../app/admin/bid/_components/AdminBoard';
import {
  BidOperatorProvider,
  useBidOperator,
} from '../../app/admin/bid/_components/BidOperatorContext';
import { BidOperatorWorkspace } from '../../app/admin/bid/_components/BidOperatorWorkspace';
import { LiveCommandBar } from '../../app/admin/bid/_components/LiveCommandBar';
import { SessionPresentationLink } from '../../app/admin/bid/_components/SessionPresentationLink';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../app/bid/_hooks/useBidWebSocket', () => ({
  useBidWebSocket: () => ({ status: 'open' }),
}));
vi.mock('../../app/admin/bid/_components/AnnualLiveControls', () => ({
  AnnualLiveControls: ({ board, isMock }: { board: ReactNode; isMock: boolean }) => (
    <div
      data-testid="shared-controls"
      data-mode={isMock ? 'mock' : 'real'}
      className="flex min-h-0 flex-1 flex-col"
    >
      {board}
    </div>
  ),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const members: Record<string, MemberLite> = {
  '1': { id: 1, firstName: 'Current', lastName: 'Member', rank: 'CPT', employeeId: '1001' },
  '2': {
    id: 2,
    firstName: 'Recorded',
    lastName: 'Member',
    rank: 'LT',
    employeeId: '1002',
    historicalContext: {
      year: 2025,
      evidenceStatus: 'RECORDED',
      historicalPositionId: 'old-B201',
      positionLabel: 'Previous rescue seat',
      shift: 'B',
      station: 'Station #2',
      unit: 'Rescue 2',
      aDayGroup: 'GR3',
      sourceName: 'Synthetic historical source',
      sourceSha256: null,
      sourceLocation: 'fixture',
      archiveSha256: null,
    },
  },
  '3': { id: 3, firstName: 'OnDeck', lastName: 'Member', rank: 'FF', employeeId: '1003' },
  '4': { id: 4, firstName: 'Directed', lastName: 'Member', rank: 'CPT', employeeId: '1004' },
};
const order = [{ memberId: 1 }, { memberId: 2 }, { memberId: 3 }, { memberId: 1 }];
const positions: PositionMeta[] = Array.from({ length: 73 }, (_, index) => ({
  id: `A${String(index + 1).padStart(3, '0')}`,
  shift: 'A',
  station: `Station #${Math.min(6, Math.floor(index / 14) + 1)}`,
  unit: `Unit ${Math.floor(index / 4) + 1}`,
  rankRequired: index % 3 === 0 ? 'CPT' : index % 3 === 1 ? 'LT' : 'FF',
  positionName: index % 3 === 0 ? 'Captain' : index % 3 === 1 ? 'Lieutenant' : 'Firefighter',
}));
const fills = { A002: { memberId: 2, ordinal: 2, bidId: 'recorded-2' } };
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        asOf: '2026-10-03',
        person: { assignments: [], serviceRecord: { hiredAt: null, rankSeniority: null } },
        qualifications: { certifications: [] },
      }),
    ),
  );
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount(element: ReactNode) {
  await act(async () => {
    root.render(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function click(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`Missing ${selector}`);
  await act(() => button.click());
}
function Probe() {
  const operator = useBidOperator();
  return (
    <output data-testid="intent">
      {JSON.stringify({ selected: operator?.selectedMemberId, position: operator?.positionIntent })}
    </output>
  );
}
function Workspace({ aDayDue = false }: { aDayDue?: boolean }) {
  return (
    <BidOperatorWorkspace
      members={members}
      bidOrder={order}
      fills={fills}
      positions={positions}
      onDeckMemberIds={[3]}
      aDayPendingMemberIds={[2]}
      aDayDueMemberIds={aDayDue ? [2] : []}
      temporarilyAssignedMemberIds={[4]}
    >
      <p>Always visible board</p>
      <Probe />
    </BidOperatorWorkspace>
  );
}

describe('board-centered operator layout', () => {
  it('preserves one immediately accessible presentation link and one copy action in compact session tools with Escape focus recovery', async () => {
    await mount(
      <BidOperatorProvider currentBidderId={1}>
        <LiveCommandBar
          bidSessionId="layout-fixture"
          isMock
          currentPhase="position_bid"
          lastSeq={0}
          sessionStartedAt={null}
          turnStartedAtMs={null}
          turnTimerSeconds={180}
          currentBidderId={1}
          currentBidder={null}
          onDeck={[]}
          managed
          presentationLink={
            <SessionPresentationLink sessionId="layout-fixture" isMock compact variant="link" />
          }
          presentationTools={
            <SessionPresentationLink sessionId="layout-fixture" isMock compact variant="copy" />
          }
        />
      </BidOperatorProvider>,
    );
    expect(host.querySelectorAll('a[aria-label="Open presentation"]')).toHaveLength(1);
    expect(
      host.querySelector('a[aria-label="Open presentation"]')?.closest('#bid-session-tools'),
    ).toBeNull();
    expect(host.querySelectorAll('button[aria-label="Copy presentation link"]')).toHaveLength(1);
    await click('[aria-controls="bid-session-tools"]');
    expect(
      host.querySelector('[aria-controls="bid-session-tools"]')?.getAttribute('aria-expanded'),
    ).toBe('true');
    const copy = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy presentation link"]',
    );
    copy?.focus();
    await act(() =>
      copy?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(
      host.querySelector('[aria-controls="bid-session-tools"]')?.getAttribute('aria-expanded'),
    ).toBe('false');
    expect(document.activeElement).toBe(host.querySelector('[aria-controls="bid-session-tools"]'));
    expect(host.querySelectorAll('[data-testid="mock-freeze-action"]')).toHaveLength(1);
  });
  it('deduplicates repeated stage turns and separates recorded seats and temporary duties from remaining members', async () => {
    await mount(
      <BidOperatorProvider currentBidderId={1}>
        <Workspace />
      </BidOperatorProvider>,
    );
    const left = host.querySelector('[aria-label="Remaining members"]');
    const right = host.querySelector('[aria-label="Members who already bid"]');
    expect(left?.querySelectorAll('li button')).toHaveLength(2);
    expect(right?.querySelectorAll('li button')).toHaveLength(2);
    expect(left?.textContent).not.toContain('Recorded Member');
    expect(right?.textContent).toContain('A002 · Unit 1');
    expect(right?.textContent).toContain('A-Day later');
    expect(right?.textContent).toContain('Temporary duty');
    expect(
      host
        .querySelector('[data-testid="operator-member-remaining-1"]')
        ?.getAttribute('data-status'),
    ).toBe('current');
    expect(
      host
        .querySelector('[data-testid="operator-member-remaining-3"]')
        ?.getAttribute('data-status'),
    ).toBe('on-deck');
  });
  it('shows the deferred A-Day becoming due without moving the recorded seat back into the remaining-seat list', async () => {
    await mount(
      <BidOperatorProvider currentBidderId={2}>
        <Workspace aDayDue />
      </BidOperatorProvider>,
    );
    expect(host.querySelector('[data-testid="operator-member-picked-2"]')?.textContent).toContain(
      'A-Day due',
    );
    expect(host.querySelector('[data-testid="operator-member-remaining-2"]')).toBeNull();
  });
  it('selects a recorded member to inspect their previous assignment without issuing a command', async () => {
    await mount(
      <BidOperatorProvider currentBidderId={1}>
        <Workspace />
      </BidOperatorProvider>,
    );
    await click('[data-testid="operator-member-picked-2"]');
    const panel = host.querySelector('[aria-label="Selected member details"]');
    expect(panel?.textContent).toContain('Recorded Member');
    expect(panel?.textContent).toContain('old-B201');
    expect(panel?.textContent).toContain('A-Day Group 3');
    expect(panel?.textContent).toContain('Selected A002');
    expect(host.querySelector('[data-testid="intent"]')?.textContent).toBe(
      '{"selected":2,"position":null}',
    );
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every((call) => String(call[0]).startsWith('/api/admin/department/people/')),
    ).toBe(true);
  });
  it('exposes narrow-screen lists through named toggles and closes the list after selecting a member', async () => {
    await mount(
      <BidOperatorProvider currentBidderId={1}>
        <Workspace />
      </BidOperatorProvider>,
    );
    await click('[aria-controls="operator-picked"]');
    expect(
      host.querySelector('[aria-controls="operator-picked"]')?.getAttribute('aria-expanded'),
    ).toBe('true');
    const memberButton = host.querySelector<HTMLButtonElement>(
      '[data-testid="operator-member-picked-2"]',
    );
    memberButton?.focus();
    expect(document.activeElement).toBe(memberButton);
    expect(memberButton?.tagName).toBe('BUTTON');
    await click('[data-testid="operator-member-picked-2"]');
    expect(
      host.querySelector('[aria-controls="operator-picked"]')?.getAttribute('aria-expanded'),
    ).toBe('false');
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Member context"]'));
    expect(document.activeElement?.textContent).toContain('Recorded Member');
  });
  it('closes a narrow member list with Escape and returns focus to its initiating toggle', async () => {
    await mount(
      <BidOperatorProvider currentBidderId={1}>
        <Workspace />
      </BidOperatorProvider>,
    );
    await click('[aria-controls="operator-remaining"]');
    const memberButton = host.querySelector<HTMLButtonElement>(
      '[data-testid="operator-member-remaining-3"]',
    );
    memberButton?.focus();
    await act(() =>
      memberButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(
      host.querySelector('[aria-controls="operator-remaining"]')?.getAttribute('aria-expanded'),
    ).toBe('false');
    expect(document.activeElement).toBe(host.querySelector('[aria-controls="operator-remaining"]'));
    expect(host.querySelector('[data-testid="intent"]')?.textContent).toBe(
      '{"selected":1,"position":null}',
    );
  });
  it('keeps the actual active bidder visible in the command bar while inspecting a different member', async () => {
    await mount(
      <BidOperatorProvider currentBidderId={1}>
        <LiveCommandBar
          bidSessionId="layout-fixture"
          isMock
          currentPhase="position_bid"
          lastSeq={0}
          sessionStartedAt={null}
          turnStartedAtMs={null}
          turnTimerSeconds={180}
          currentBidderId={1}
          currentBidder={{
            memberId: 1,
            ordinal: 1,
            pool: 'OFC',
            firstName: 'Current',
            lastName: 'Member',
            rank: 'CPT',
            employeeId: '1001',
          }}
          onDeck={[]}
          managed
        />
        <Workspace />
      </BidOperatorProvider>,
    );
    await click('[data-testid="operator-member-picked-2"]');
    expect(host.querySelector('[aria-label="Selected member details"]')?.textContent).toContain(
      'Recorded Member',
    );
    expect(host.querySelector('[data-testid="active-bidder-name"]')?.textContent).toBe(
      'CPT Current Member',
    );
    await click('button[aria-label="Current bidder"]');
    expect(host.querySelector('[aria-label="Selected member details"]')?.textContent).toContain(
      'Current Member',
    );
  });
  it('shows all 73 immutable positions and opens occupant details instead of preparing an occupied-seat award', async () => {
    await mount(
      <BidOperatorProvider currentBidderId={1}>
        <AdminBoard
          bidSessionId="layout-fixture"
          initialSeq={0}
          meMemberId={1}
          initialFills={fills}
          initialCurrentBidderId={1}
          members={members}
          positions={positions}
          advisory={null}
          managed
          workspace
        />
        <Probe />
      </BidOperatorProvider>,
    );
    expect(host.querySelectorAll('[data-testid^="position-cell-"]')).toHaveLength(73);
    await click('[data-testid="position-cell-A002"]');
    expect(host.querySelector('[data-testid="intent"]')?.textContent).toBe(
      '{"selected":2,"position":null}',
    );
    await click('[data-testid="position-cell-A001"]');
    expect(host.querySelector('[data-testid="intent"]')?.textContent).toContain(
      '"memberId":2,"positionId":"A001"',
    );
  });
  it('filters open seats and selected rank as display choices without changing fills or making an award', async () => {
    await mount(
      <BidOperatorProvider currentBidderId={1}>
        <AdminBoard
          bidSessionId="layout-fixture"
          initialSeq={0}
          meMemberId={1}
          initialFills={fills}
          initialCurrentBidderId={1}
          members={members}
          positions={positions}
          advisory={null}
          managed
          workspace
        />
        <Probe />
      </BidOperatorProvider>,
    );
    const button = (text: string) =>
      [...host.querySelectorAll('button')].find((node) => node.textContent === text);
    await act(() => button('Open seats')?.click());
    expect(host.querySelector('[data-testid="position-cell-A002"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid^="position-cell-"]')).toHaveLength(72);
    await act(() => button('CPT seats')?.click());
    expect(host.querySelectorAll('[data-testid^="position-cell-"]')).toHaveLength(25);
    expect(host.querySelector('[data-testid="intent"]')?.textContent).toBe(
      '{"selected":1,"position":null}',
    );
  });
  it.each([true, false])(
    'uses the same always-visible board and member rails in Mock=%s',
    async (isMock) => {
      await mount(
        <AdminBidShell
          bidSessionId="shared-mode-layout"
          lastSeq={0}
          currentPhase="position_bid"
          currentBidderId={1}
          currentBidder={null}
          onDeck={[]}
          bidOrder={order.map((entry, index) => ({ ...entry, ordinal: index + 1, pool: 'OFC' }))}
          bidOrderPreview={false}
          sessionStartedAt={null}
          turnStartedAtMs={0}
          turnTimerSeconds={180}
          meMemberId={1}
          initialFills={fills}
          members={members}
          positions={positions}
          wsBase="https://worker.invalid"
          isMock={isMock}
          mockControlRevision={0}
          annual={{}}
          advisory={null}
        />,
      );
      expect(host.querySelector('[data-testid="shared-controls"]')?.getAttribute('data-mode')).toBe(
        isMock ? 'mock' : 'real',
      );
      expect(
        host.querySelector('[data-testid="station-grouped-grid"]')?.closest('details'),
      ).toBeNull();
      expect(host.querySelectorAll('[data-testid^="position-cell-"]')).toHaveLength(73);
      expect(host.querySelector('[aria-label="Remaining members"]')).not.toBeNull();
      expect(host.querySelector('[aria-label="Members who already bid"]')).not.toBeNull();
      expect(host.querySelectorAll('button[aria-label="Export shifts"]')).toHaveLength(1);
    },
  );
  it.each([true, false])(
    'carries the selected board shift into exports in Mock=%s',
    async (isMock) => {
      await mount(
        <AdminBidShell
          bidSessionId="shared-export-context"
          lastSeq={0}
          currentPhase="position_bid"
          currentBidderId={1}
          currentBidder={null}
          onDeck={[]}
          bidOrder={order.map((entry, index) => ({ ...entry, ordinal: index + 1, pool: 'OFC' }))}
          bidOrderPreview={false}
          sessionStartedAt={null}
          turnStartedAtMs={0}
          turnTimerSeconds={180}
          meMemberId={1}
          initialFills={fills}
          members={members}
          positions={positions}
          wsBase="https://worker.invalid"
          isMock={isMock}
          mockControlRevision={0}
          annual={{}}
          advisory={null}
        />,
      );
      await click('[data-testid="shift-tab-B"]');
      expect(host.querySelector('[data-testid="shift-tab-B"]')?.getAttribute('aria-selected')).toBe(
        'true',
      );
      await click('button[aria-label="Export shifts"]');
      const exportScope = document.querySelector('select[aria-label="Export shifts"]');
      expect(exportScope instanceof HTMLSelectElement ? exportScope.value : null).toBe('B');
      const moreReports = Array.from(document.querySelectorAll('a')).find(
        (link) => link.textContent === 'More reports',
      );
      expect(moreReports?.getAttribute('href')).toBe(
        '/admin/exports?session_id=shared-export-context&shift=B',
      );
      expect(host.querySelector('[data-testid="intent"]')?.textContent ?? '').not.toContain(
        'positionId',
      );
    },
  );
  it.each(
    [true, false].flatMap((isMock) =>
      ['config', 'paused', 'complete', 'legacy'].map((phase) => ({ isMock, phase })),
    ),
  )('keeps one usable Export control in $phase Mock=$isMock', async ({ isMock, phase }) => {
    await mount(
      <AdminBidShell
        bidSessionId="phase-export-context"
        lastSeq={0}
        currentPhase={phase === 'legacy' ? 'bid' : phase}
        currentBidderId={1}
        currentBidder={null}
        onDeck={[]}
        bidOrder={order.map((entry, index) => ({ ...entry, ordinal: index + 1, pool: 'OFC' }))}
        bidOrderPreview={false}
        sessionStartedAt={null}
        turnStartedAtMs={0}
        turnTimerSeconds={180}
        meMemberId={1}
        initialFills={fills}
        members={members}
        positions={positions}
        wsBase="https://worker.invalid"
        isMock={isMock}
        mockControlRevision={0}
        annual={phase === 'legacy' ? null : {}}
        advisory={null}
      />,
    );
    const action = host.querySelectorAll<HTMLButtonElement>('button[aria-label="Export shifts"]');
    expect(action).toHaveLength(1);
    expect(action[0]?.disabled).toBe(false);
    await click('button[aria-label="Export shifts"]');
    expect(document.querySelector('select[aria-label="Export format"]')).not.toBeNull();
    expect(
      Array.from(document.querySelectorAll('button')).some(
        (button) => button.textContent === 'Download PDF' && !button.disabled,
      ),
    ).toBe(true);
  });
});
