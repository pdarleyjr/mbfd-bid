// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberLite, PositionMeta } from '../../app/_components/bid/types';
import { AnnualLiveControls } from '../../app/admin/bid/_components/AnnualLiveControls';
import { BidOperatorProvider } from '../../app/admin/bid/_components/BidOperatorContext';
import { BidOperatorWorkspace } from '../../app/admin/bid/_components/BidOperatorWorkspace';
import { LiveCommandBar } from '../../app/admin/bid/_components/LiveCommandBar';

vi.mock('@/components/admin/TaskPanel', () => ({
  TaskPanel: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const members: Record<string, MemberLite> = {
  '17': {
    id: 17,
    firstName: 'Current',
    lastName: 'OperatorFixture',
    rank: 'CPT',
    employeeId: 'fixture17',
    historicalContext: {
      year: 2025,
      evidenceStatus: 'RECORDED',
      historicalPositionId: 'old-A109',
      positionLabel: '2025 Rescue Lieutenant',
      shift: 'A',
      station: 'Station 1',
      unit: 'Rescue 1',
      aDayGroup: 'GR4',
      sourceName: 'Synthetic 2025 documentary source',
      sourceSha256: 'synthetic',
      sourceLocation: 'row 9',
      archiveSha256: 'synthetic',
    },
  },
  '18': {
    id: 18,
    firstName: 'New',
    lastName: 'OperatorFixture',
    rank: 'CPT',
    employeeId: 'fixture18',
    historicalContext: {
      year: 2025,
      evidenceStatus: 'NO_PRIOR_BID_OR_ASSIGNMENT',
      historicalPositionId: null,
      positionLabel: null,
      shift: null,
      station: null,
      unit: null,
      aDayGroup: null,
      sourceName: 'Synthetic explicit no-prior evidence',
      sourceSha256: null,
      sourceLocation: null,
      archiveSha256: null,
    },
  },
};
const positions: PositionMeta[] = [
  {
    id: 'Anew',
    shift: 'A',
    station: 'Station 2',
    unit: 'Engine 2',
    rankRequired: 'CPT',
    positionName: 'Captain',
  },
  {
    id: 'not-eligible',
    shift: 'A',
    station: 'Station 4',
    unit: 'Engine 4',
    rankRequired: 'CPT',
    positionName: 'Captain',
  },
];
const live = {
  sequence: 4,
  current_phase: 'position_bid',
  a_day_selection: 'SIMULTANEOUS',
  a_day_combat_groups: ['G1', 'G2', 'G3', 'G4'],
  current_bidder: {
    member_id: 17,
    first_name: 'Current',
    last_name: 'OperatorFixture',
    rank: 'CPT',
  },
  selection_stage: {
    id: 'captains',
    label: 'Captain selection',
    opportunity_position_ids: ['Anew', 'not-eligible'],
    eligible_position_ids: ['Anew'],
    all_opportunities_filled: false,
    next_stage: null,
  },
  remaining_order: [17, 18],
  fills: {},
  specialties: [],
  active: null,
};
let root: Root | undefined;
let container: HTMLDivElement;
let commands: Record<string, unknown>[];
let requests: string[];
let originalFetch: typeof fetch;
let reject = false;
let updatesUnavailable = false;
let failReadAfterAward = false;
let returnedMember = false;
let liveSequence = 4;
let overrideAllowed = false;
let livePhase = 'position_bid';
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
beforeEach(() => {
  originalFetch = window.fetch;
  commands = [];
  requests = [];
  reject = false;
  updatesUnavailable = false;
  failReadAfterAward = false;
  returnedMember = false;
  liveSequence = 4;
  overrideAllowed = false;
  livePhase = 'position_bid';
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('/specialty-live'))
      return updatesUnavailable
        ? response({ error: 'synthetic_connection_lost' }, 503)
        : response({
            ...live,
            current_phase: livePhase,
            sequence: liveSequence,
            admin_override_allowed: overrideAllowed,
            admin_override_member_ids: overrideAllowed ? [17, 18] : [],
            admin_override_position_ids: overrideAllowed ? ['Anew', 'not-eligible'] : [],
            returning_member: returnedMember
              ? { member_id: 18, first_name: 'New', last_name: 'OperatorFixture', rank: 'CPT' }
              : null,
          });
    if (url === '/api/auth/csrf')
      return response({ token: 'csrf_00000000-0000-0000-0000-000000000001' });
    if (url.startsWith('/api/admin/department/people/'))
      return response({
        asOf: '2026-09-30',
        person: { assignments: [], serviceRecord: { hiredAt: '2024-01-01', rankSeniority: 1 } },
        qualifications: { certifications: [] },
      });
    if (url.endsWith('/commands/live')) {
      const command = JSON.parse(String(init?.body));
      commands.push(command);
      if (!reject && command.type === 'live.pause') livePhase = 'paused';
      if (!reject && command.type === 'live.resume') livePhase = 'position_bid';
      if (!reject && failReadAfterAward) updatesUnavailable = true;
      return reject
        ? response({ kind: 'rejected', code: 'LIVE_STAGE_NOT_ELIGIBLE' }, 409)
        : response({ kind: 'accepted' });
    }
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  window.fetch = fetcher;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  window.fetch = originalFetch;
  vi.useRealTimers();
  document.body.replaceChildren();
});
async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(isMock = true) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await settle(() =>
    root?.render(
      <BidOperatorProvider currentBidderId={17}>
        <LiveCommandBar
          bidSessionId="isolated-synthetic"
          isMock={false}
          lastSeq={4}
          currentPhase="position_bid"
          sessionStartedAt={null}
          turnStartedAtMs={null}
          turnTimerSeconds={180}
          currentBidder={null}
          currentBidderId={17}
          onDeck={[]}
          managed
        />
        <BidOperatorWorkspace members={members} bidOrder={[{ memberId: 17 }, { memberId: 18 }]}>
          <AnnualLiveControls
            bidSessionId="isolated-synthetic"
            isMock={isMock}
            currentBidderId={17}
            bidOrder={[{ memberId: 17 }, { memberId: 18 }]}
            fills={{}}
            members={members}
            positions={positions}
            workspace
          />
        </BidOperatorWorkspace>
      </BidOperatorProvider>,
    ),
  );
}
function button(text: string) {
  const node = [...container.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(text),
  );
  if (!node) throw new Error(`Missing ${text}`);
  return node;
}
async function chooseGroup(value: string) {
  await settle(() => {
    const select = container.querySelector(
      'select[aria-label="Selection A-Day"]',
    ) as unknown as HTMLSelectElement | null;
    if (!select) throw new Error('Missing A-Day selection');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
describe('operator workspace interaction and history', () => {
  it.each([true, false])(
    'saves and resumes the same %s Mock-mode session without a note or new bid',
    async (isMock) => {
      await mount(isMock);
      await settle(() => button('Pause or resume bid').click());
      const sameBid = [...container.querySelectorAll('a')].find(
        (link) => link.textContent === 'Return to this bid',
      );
      expect(sameBid?.getAttribute('href')).toBe('/admin/bid?session_id=isolated-synthetic');
      expect(commands).toHaveLength(0);
      await settle(() => button('Pause bid').click());
      expect(commands[0]).toMatchObject({ type: 'live.pause', expectedSeq: 4 });
      expect(container.textContent).toContain('Bid paused and saved.');
      expect(container.textContent).toContain('current turn are saved');
      expect(button('Resume bid').disabled).toBe(false);
      expect(container.textContent?.includes('Find saved Mocks')).toBe(isMock);
      await settle(() => button('Resume bid').click());
      expect(commands[1]).toMatchObject({ type: 'live.resume', expectedSeq: 4 });
      expect(container.textContent).toContain('Bid resumed. Continuing the saved turn.');
      expect(requests.some((url) => url.includes('/sessions/new'))).toBe(false);
      expect(commands.map((command) => command.type)).toEqual(['live.pause', 'live.resume']);
    },
  );
  it('keeps the saved pause acknowledgement when the following state refresh fails', async () => {
    await mount();
    await settle(() => button('Pause or resume bid').click());
    failReadAfterAward = true;
    await settle(() => button('Pause bid').click());
    expect(commands).toHaveLength(1);
    expect(container.textContent).toContain('Bid paused and saved.');
    expect(container.textContent).toContain('Refresh bid updates before recording another action.');
    expect(button('Pause bid').disabled).toBe(true);
  });
  it('lets Record selection choose a seat inside its panel before explicit confirmation', async () => {
    await mount();
    await settle(() => button('Record selection').click());
    const seats = container.querySelector(
      'select[aria-label="Position selected by current bidder"]',
    ) as unknown as HTMLSelectElement;
    expect([...seats.options].map((option) => option.value)).toEqual(['', 'Anew']);
    expect(seats.options[1]?.text).toContain('A Shift · Station 2 · Engine 2 · Captain');
    expect(container.textContent).not.toContain('Choose an available position above');
    expect(button('Confirm bid').disabled).toBe(true);
    await settle(() => {
      seats.value = 'Anew';
      seats.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await chooseGroup('G2');
    expect(button('Confirm bid').disabled).toBe(false);
    expect(commands).toHaveLength(0);
    await settle(() => button('Confirm bid').click());
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: 'live.record_selection',
      memberId: 17,
      positionId: 'Anew',
      aDay: 'G2',
      expectedSeq: 4,
    });
  });
  it('opens an explicit override for the waiting member chosen in the normal picker without recording anything', async () => {
    overrideAllowed = true;
    await mount();
    await settle(() => button('New OperatorFixture').click());
    expect(container.textContent).toContain('No previous bid or assignment.');
    await settle(() => button('Bid for this member').click());
    const select = container.querySelector(
      'select[aria-label="Administrator override member"]',
    ) as unknown as HTMLSelectElement;
    expect(select.value).toBe('18');
    const positions = container.querySelector(
      'select[aria-label="Administrator override open position"]',
    ) as unknown as HTMLSelectElement;
    expect([...positions.options].map((option) => option.value)).toEqual([
      '',
      'Anew',
      'not-eligible',
    ]);
    expect(button('Review adjustment').disabled).toBe(true);
    expect(commands).toHaveLength(0);
    expect(requests.some((url) => url.endsWith('/commands/live/preview'))).toBe(false);
  });
  it('previews member history before Start without presenting the member as a waiting bidder', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await settle(() =>
      root?.render(
        <BidOperatorProvider currentBidderId={null}>
          <BidOperatorWorkspace
            members={members}
            bidOrder={[{ memberId: 17 }, { memberId: 18 }]}
            preview
          >
            Session setup
          </BidOperatorWorkspace>
        </BidOperatorProvider>,
      ),
    );
    await settle(() => button('Current OperatorFixture').click());
    expect(container.textContent).toContain('2025 Rescue Lieutenant');
    expect(container.textContent).toContain('A-Day Group 4');
    expect(container.textContent).not.toContain('This member is waiting');
    expect(container.textContent).not.toContain('Up now');
    expect(commands).toHaveLength(0);
  });
  it('retains a draft after unchanged verified sign-in without automatically submitting it', async () => {
    await mount();
    await settle(() => button('Engine 2').click());
    await chooseGroup('G2');
    await settle(() => window.dispatchEvent(new Event('mbfd-operator-reauth-started')));
    expect(button('Confirm bid').disabled).toBe(true);
    expect(commands).toHaveLength(0);
    await settle(() => window.dispatchEvent(new Event('mbfd-operator-auth-refreshed')));
    expect(button('Confirm bid').disabled).toBe(false);
    expect(
      (
        container.querySelector(
          'select[aria-label="Selection A-Day"]',
        ) as unknown as HTMLSelectElement
      ).value,
    ).toBe('G2');
    expect(commands).toHaveLength(0);
  });
  it('captures the earliest sign-in sequence and requires deliberate review after intervening updates', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await mount();
    await settle(() => button('Engine 2').click());
    await chooseGroup('G3');
    await settle(() => window.dispatchEvent(new Event('mbfd-operator-reauth-started')));
    liveSequence = 5;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await settle(() => window.dispatchEvent(new Event('mbfd-operator-reauth-started')));
    await settle(() => window.dispatchEvent(new Event('mbfd-operator-auth-refreshed')));
    expect(container.textContent).toContain('The bid changed during sign-in.');
    expect(button('Confirm bid').disabled).toBe(true);
    expect(commands).toHaveLength(0);
    await settle(() => button('I reviewed the latest bid state').click());
    expect(button('Confirm bid').disabled).toBe(false);
    expect(commands).toHaveLength(0);
    await settle(() => button('Confirm bid').click());
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ expectedSeq: 5, aDay: 'G3', positionId: 'Anew' });
  });
  it('returns to the active returned member instead of the waiting ordinary bidder', async () => {
    returnedMember = true;
    await mount();
    await settle(() => button('Current OperatorFixture').click());
    expect(
      container.querySelector('[aria-label="Selected member details"]')?.textContent,
    ).toContain('Current OperatorFixture');
    await settle(() => button('Current bidder').click());
    expect(
      container.querySelector('[aria-label="Selected member details"]')?.textContent,
    ).toContain('New OperatorFixture');
    expect(button('Engine 2').disabled).toBe(false);
    expect(commands).toHaveLength(0);
  });
  it('keeps the accepted acknowledgement and blocks actions when the following refresh fails', async () => {
    await mount();
    await settle(() => button('Engine 2').click());
    await chooseGroup('G3');
    failReadAfterAward = true;
    await settle(() => button('Confirm bid').click());
    expect(commands).toHaveLength(1);
    expect(container.textContent).toContain('Action recorded.');
    expect(container.textContent).toContain('Bid updates are unavailable');
    expect(button('Confirm bid').disabled).toBe(true);
    await settle(() => button('Engine 2').click());
    await chooseGroup('G2');
    expect(button('Confirm bid').disabled).toBe(true);
    expect(commands).toHaveLength(1);
  });
  it('blocks recording when updates fail and preserves the draft through reconnection', async () => {
    await mount();
    await settle(() => button('Engine 2').click());
    await chooseGroup('G2');
    updatesUnavailable = true;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2600));
    });
    expect(container.textContent).toContain('Bid updates are unavailable');
    expect(button('Confirm bid').disabled).toBe(true);
    expect(commands).toHaveLength(0);
    updatesUnavailable = false;
    await settle(() => button('Retry bid updates').click());
    expect(button('Confirm bid').disabled).toBe(false);
    expect(
      (
        container.querySelector(
          'select[aria-label="Selection A-Day"]',
        ) as unknown as HTMLSelectElement
      )?.value,
    ).toBe('G2');
  });
  it('shows historical year, assignment label and group without interpreting the old ID as a current position', async () => {
    await mount();
    const previous = container.querySelector('[aria-label="Previous bid and assignment"]');
    expect(previous?.textContent).toContain('2025 bid / assignment');
    expect(previous?.textContent).toContain('2025 Rescue Lieutenant');
    expect(previous?.textContent).toContain('old-A109');
    expect(previous?.textContent).toContain('Group 4');
    expect(
      container.querySelector('[aria-label="Available positions"]')?.textContent,
    ).not.toContain('Engine 4');
    expect(requests.some((url) => url.includes('/manual-pick'))).toBe(false);
  });
  it('opens details for a waiting member, explains the turn boundary and never bids for them accidentally', async () => {
    await mount();
    await settle(() => button('New OperatorFixture').click());
    expect(
      container.querySelector('[aria-label="Selected member details"]')?.textContent,
    ).toContain('New OperatorFixture');
    expect(container.textContent).toContain('No previous bid or assignment.');
    expect(container.textContent).toContain('This member is waiting.');
    expect(button('Engine 2').disabled).toBe(true);
    expect(
      [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Confirm bid'),
      ),
    ).toBeUndefined();
    expect(commands).toHaveLength(0);
    await settle(() => button('Return to current bidder').click());
    expect(button('Engine 2').disabled).toBe(false);
  });
  it('prepares a position and numbered group, then submits only one canonical command on explicit confirmation', async () => {
    await mount();
    expect(container.querySelector('select[aria-label="Selection A-Day"]')).toBeNull();
    await settle(() => button('Engine 2').click());
    expect(commands).toHaveLength(0);
    const select = container.querySelector(
      'select[aria-label="Selection A-Day"]',
    ) as unknown as HTMLSelectElement | null;
    if (!select) throw new Error('Missing A-Day selection');
    expect([...select.options].map((option) => option.text)).toEqual([
      'Select A-Day',
      'Group 1',
      'Group 2',
      'Group 3',
      'Group 4',
    ]);
    await chooseGroup('G3');
    await settle(() => button('Confirm bid').click());
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: 'live.record_selection',
      memberId: 17,
      positionId: 'Anew',
      aDay: 'G3',
      expectedSeq: 4,
    });
    expect(commands[0]?.reason).toContain('Anew');
    expect(requests.some((url) => url.includes('/manual-pick'))).toBe(false);
  });
  it('displays a rejected command beside the prepared selection and preserves the selected group', async () => {
    await mount();
    await settle(() => button('Engine 2').click());
    await chooseGroup('G2');
    reject = true;
    await settle(() => button('Confirm bid').click());
    expect(container.textContent).toContain('outside the bidder’s current stage');
    expect(
      (
        container.querySelector(
          'select[aria-label="Selection A-Day"]',
        ) as unknown as HTMLSelectElement | null
      )?.value,
    ).toBe('G2');
    expect(commands).toHaveLength(1);
  });
});
