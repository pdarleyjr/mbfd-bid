// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PositionMeta } from '../../app/_components/bid/types';
import { AnnualLiveControls } from '../../app/admin/bid/_components/AnnualLiveControls';

vi.mock('@/components/admin/TaskPanel', () => ({
  TaskPanel: ({ open, title, children }: { open: boolean; title: string; children: ReactNode }) =>
    open ? <div data-panel-title={title}>{children}</div> : null,
}));
const operator = {
  selectedMemberId: 17,
  setActiveMember: vi.fn(),
  setOverrideAllowed: vi.fn(),
  requestOverride: vi.fn(),
};
vi.mock('../../app/admin/bid/_components/BidOperatorContext', () => ({
  useBidOperator: () => operator,
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

let root: Root | undefined;
let container: HTMLDivElement;
let originalWindowFetch: typeof fetch;
let live: Record<string, unknown>;
let commands: Record<string, unknown>[];
let previews: Record<string, unknown>[];
let rank: 'CPT' | 'LT' | 'FF';
let reviewFailure: boolean;
let malformedReview: 'null' | 'missing-candidates' | null;
let combinedReadback: boolean;
let continueReview: boolean;
let advisoryReview: boolean;

const requester = () => ({
  member_id: 17,
  first_name: 'Synthetic Senior',
  last_name: 'Requester',
  rank,
  points: 1,
});
const higher = () => ({
  member_id: 9,
  first_name: 'Synthetic Qualified',
  last_name: 'Candidate',
  rank,
  points: 10,
  policy_rank: 1,
});
const response = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
function activeReview() {
  return {
    specialty_id: 'synthetic-investigator',
    specialty_label: 'Investigator',
    requested_position_id: 'S-A',
    original_bidder: requester(),
    candidates: [higher()],
    current_candidate_id: 9,
    remaining_candidate_ids: [9],
    eligible_position_ids: ['S-A', 'S-B'],
    suspended_turn: true,
    resume: { member_id: 17, queue_cursor: 0, current_phase: 'position_bid' },
  };
}
beforeEach(() => {
  originalWindowFetch = window.fetch;
  rank = 'CPT';
  commands = [];
  previews = [];
  reviewFailure = false;
  malformedReview = null;
  combinedReadback = false;
  continueReview = false;
  advisoryReview = false;
  operator.requestOverride.mockReset();
  live = {
    sequence: 4,
    current_phase: 'position_bid',
    current_bidder: requester(),
    active: null,
    remaining_order: [17, 9],
    fills: {},
    a_day_selection: 'SIMULTANEOUS',
    a_day_timing_by_position: {
      'S-A': 'AFTER_POSITION_SELECTION',
      'S-B': 'AFTER_POSITION_SELECTION',
    },
    a_day_combat_groups: ['G1', 'G2', 'G3', 'G4'],
    a_day_current: null,
    selection_stage: {
      id: 'synthetic-ordinary',
      label: 'Ordinary rank turn',
      eligible_position_ids: ['S-A', 'S-B', 'R-A'],
    },
    specialties: [
      {
        id: 'synthetic-investigator',
        label: 'Investigator',
        mode: 'INTERRUPTING',
        positions: [
          { id: 'S-A', label: 'Investigator A' },
          { id: 'S-B', label: 'Investigator B' },
        ],
      },
    ],
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/specialty-live')) return response(live);
    if (url.includes('/specialty-review?')) {
      if (reviewFailure) return new Response('{}', { status: 503 });
      const review: Record<string, unknown> = {
        sequence: live.sequence,
        status: advisoryReview ? 'ADVISORY_HIGHER_PRIORITY' : 'HIGHER_PRIORITY',
        selection_review: {
          member_id: 17,
          position_id: 'S-A',
          specialty_id: advisoryReview ? null : 'synthetic-investigator',
          ...(advisoryReview ? { mode: 'ADVISORY' } : {}),
          specialty_label: 'Investigator',
          higher_priority_candidates: [higher()],
          eligible_related_position_ids: ['S-A', 'S-B'],
          a_day_timing: advisoryReview ? 'ADMIN_REVIEW' : 'ORDINARY_TURN',
        },
      };
      if (malformedReview === 'null') review.selection_review = null;
      if (malformedReview === 'missing-candidates')
        (review.selection_review as Record<string, unknown>).higher_priority_candidates = undefined;
      return response(review);
    }
    if (url === '/api/auth/csrf')
      return response({ token: 'csrf_00000000-0000-0000-0000-000000000001' });
    if (url.endsWith('/commands/live/preview')) {
      const body = JSON.parse(String(init?.body));
      previews.push(body);
      return response({
        valid: true,
        expectedSeq: body.expectedSeq,
        memberId: body.memberId,
        warnings: [{ code: 'POLICY_DEVIATION', message: 'The action changes normal policy.' }],
      });
    }
    if (url.endsWith('/commands/live')) {
      const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
      commands.push(command);
      live.sequence = Number(live.sequence) + 1;
      if (command.type === 'live.start_specialty_adjudication') live.active = activeReview();
      if (command.type === 'live.resolve_specialty_candidate') {
        live.active = continueReview
          ? {
              ...activeReview(),
              current_candidate_id: 8,
              eligible_position_ids: ['S-A'],
              candidates: [{ ...higher(), member_id: 8 }],
            }
          : null;
        live.fills = { 'S-B': { member_id: 9, a_day: null } };
        if (combinedReadback)
          live.a_day_current = {
            member_id: 9,
            position_id: 'S-B',
            shift: 'B',
            eligible_a_days: ['G2', 'G3'],
          };
      }
      if (command.type === 'live.close_specialty_adjudication') live.active = null;
      if (command.type === 'live.record_selection')
        live.a_day_current = {
          member_id: 9,
          position_id: 'S-B',
          shift: 'B',
          eligible_a_days: ['G2', 'G3'],
        };
      if (command.type === 'live.record_a_day') live.a_day_current = null;
      return response({ kind: 'accepted' });
    }
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  window.fetch = fetcher;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.fetch = originalWindowFetch;
  document.body.replaceChildren();
});
async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
function button(label: string) {
  const node = [...container.querySelectorAll('button')].find(
    (entry) => entry.textContent?.trim() === label,
  );
  if (!node) throw new Error(`Missing button ${label}`);
  return node;
}
async function choose(label: string, value: string) {
  await settle(() => {
    const node = container.querySelector(
      `select[aria-label="${label}"]`,
    ) as unknown as HTMLSelectElement;
    if (!node) throw new Error(`Missing select ${label}`);
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function fill(label: string, value: string) {
  await settle(() => {
    const node =
      container.querySelector(`input[aria-label="${label}"]`) ??
      [...container.querySelectorAll('label')]
        .find((entry) => entry.textContent?.includes(label))
        ?.querySelector('input');
    if (!node) throw new Error(`Missing input ${label}`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function mount(isMock = true) {
  live.current_bidder = requester();
  const positions: PositionMeta[] = ['S-A', 'S-B', 'R-A'].map((id) => ({
    id,
    shift: id === 'S-B' ? 'B' : 'A',
    station: '1',
    unit: 'Synthetic',
    rankRequired: rank,
    positionName: id.startsWith('S') ? 'Investigator' : 'Regular seat',
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await settle(() =>
    root?.render(
      <AnnualLiveControls
        bidSessionId="synthetic-workflow"
        isMock={isMock}
        workspace
        currentBidderId={17}
        bidOrder={[{ memberId: 17 }, { memberId: 9 }]}
        fills={{}}
        members={{
          '17': {
            id: 17,
            firstName: 'Synthetic Senior',
            lastName: 'Requester',
            rank,
            employeeId: 'synthetic17',
          },
          '9': {
            id: 9,
            firstName: 'Synthetic Qualified',
            lastName: 'Candidate',
            rank,
            employeeId: 'synthetic9',
          },
        }}
        positions={positions}
      />,
    ),
  );
}

describe('contextual specialty and deferred A-Day operator workflow', () => {
  it.each([true, false])(
    'moves the ordinary turn ahead of the same member Days turn with exact reviewed identities (Mock %s)',
    async (isMock) => {
      live.remaining_order = [17, 9, 17];
      live.remaining_turns = [
        { memberId: 17, stageId: 'days', stage_label: 'Days positions' },
        { memberId: 9, stageId: 'captains', stage_label: 'Captains' },
        { memberId: 17, stageId: null, stage_label: 'Ordinary rank turn' },
      ];
      live.admin_override_allowed = true;
      await mount(isMock);
      await settle(() => button('Bid order').click());
      expect(container.textContent).toContain('CPT Synthetic Senior Requester · Days positions');
      expect(container.textContent).toContain(
        'CPT Synthetic Senior Requester · Ordinary rank turn · turn 2',
      );
      await settle(() =>
        (
          container.querySelector(
            'button[aria-label="Make CPT Synthetic Senior Requester next (turn 2)"]',
          ) as HTMLButtonElement
        ).click(),
      );
      await fill('Operator reason', 'Synthetic ordinary turn priority approved');
      await settle(() => button('Review bid order').click());
      const exactTurns = [
        { memberId: 17, stageId: null },
        { memberId: 17, stageId: 'days' },
        { memberId: 9, stageId: 'captains' },
      ];
      expect(previews[0]).toMatchObject({
        type: 'live.alter_order',
        orderedRemainingMemberIds: [17, 17, 9],
        orderedRemainingTurns: exactTurns,
      });
      expect(commands).toHaveLength(0);
      await settle(() =>
        (
          container.querySelector('input[aria-label="I reviewed bid order"]') as HTMLInputElement
        ).click(),
      );
      await settle(() => button('Confirm bid order').click());
      expect(commands[0]).toMatchObject({
        type: 'live.alter_order',
        orderedRemainingMemberIds: [17, 17, 9],
        orderedRemainingTurns: exactTurns,
        adminOverride: { acknowledged: true, warningCodes: ['POLICY_DEVIATION'] },
      });
    },
  );
  it('makes a selected member next while retaining every remaining turn and recording the reason', async () => {
    live.remaining_order = [17, 9, 17];
    live.admin_override_allowed = true;
    await mount();
    await settle(() => button('Bid order').click());
    expect(container.textContent).toContain('Every remaining turn is retained');
    expect(container.textContent).toContain('CPT Synthetic Senior Requester · turn 2');
    await settle(() =>
      (
        container.querySelector(
          'button[aria-label="Make CPT Synthetic Qualified Candidate next"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(commands).toHaveLength(0);
    await fill('Operator reason', 'Synthetic operator approved priority change');
    await settle(() => button('Review bid order').click());
    expect(commands).toHaveLength(0);
    await settle(() =>
      (
        container.querySelector('input[aria-label="I reviewed bid order"]') as HTMLInputElement
      ).click(),
    );
    await settle(() => button('Confirm bid order').click());
    expect(commands[0]).toMatchObject({
      type: 'live.alter_order',
      orderedRemainingMemberIds: [9, 17, 17],
      reason: 'Synthetic operator approved priority change',
    });
  });
  it('requires an explicitly selected eligible specialty seat before accepting', async () => {
    live.active = activeReview();
    await mount();
    await choose('Specialty seat to offer', '');
    expect(button('ACCEPT').disabled).toBe(true);
    await settle(() => button('ACCEPT').click());
    expect(commands).toHaveLength(0);
    expect(operator.setActiveMember).toHaveBeenLastCalledWith(9);
  });
  it.each(['null', 'missing-candidates'] as const)(
    'blocks malformed higher-priority review %s without an award',
    async (malformed) => {
      malformedReview = malformed;
      await mount();
      const seat = [...container.querySelectorAll('button')].find((node) =>
        node.textContent?.includes('S-A'),
      );
      await settle(() => seat?.click());
      expect(container.textContent).toContain('The specialty review response is unavailable');
      expect(button('Confirm bid').disabled).toBe(true);
      expect(button('Retry specialty review')).toBeDefined();
      expect(commands).toHaveLength(0);
    },
  );
  it('opens the due A-Day when one readback closes specialty review and exposes the ordinary turn', async () => {
    combinedReadback = true;
    live.active = activeReview();
    await mount();
    await choose('Specialty seat to offer', 'S-B');
    await settle(() => button('ACCEPT').click());
    expect(
      container.querySelector('[data-panel-title="Record controlled A-Day selection"]'),
    ).not.toBeNull();
    const ineligible = container.querySelector(
      'select[aria-label="Controlled A-Day"] option[value="G1"]',
    ) as HTMLOptionElement | null;
    expect(ineligible?.disabled).toBe(true);
    expect(ineligible?.textContent).toContain('Unavailable for this recorded seat');
  });
  it('continues to the next specialty candidate and can explicitly resume the original bidder', async () => {
    continueReview = true;
    live.active = activeReview();
    await mount();
    await choose('Specialty seat to offer', 'S-B');
    await settle(() => button('ACCEPT').click());
    expect(container.querySelector('[data-panel-title="Specialty and contact"]')).not.toBeNull();
    expect(
      [...container.querySelectorAll('output')].filter(
        (node) => node.textContent === 'Action recorded.',
      ),
    ).toHaveLength(1);
    expect(operator.setActiveMember).toHaveBeenLastCalledWith(8);
    expect(
      (
        container.querySelector(
          'select[aria-label="Specialty seat to offer"]',
        ) as unknown as HTMLSelectElement
      ).value,
    ).toBe('S-A');
    await settle(() => button('Resume original bidder').click());
    expect(commands[1]).toMatchObject({ type: 'live.close_specialty_adjudication' });
    expect(commands[1]?.reason).toContain('unresponded priority rights remain pending');
    expect(operator.setActiveMember).toHaveBeenLastCalledWith(17);
  });
  it('shows one explicit next-stage action when both Days Captain seats are filled', async () => {
    live.selection_stage = {
      id: 'days-captains',
      label: 'Days Captain',
      eligible_position_ids: [],
      all_opportunities_filled: true,
      next_stage: { id: 'captains', label: 'Captain bidding' },
    };
    await mount();
    expect(container.textContent).toContain('All Days Captain seats are filled.');
    expect(button('Continue to Captain bidding').disabled).toBe(false);
    expect(container.textContent).not.toContain('No eligible openings in this stage.');
    await settle(() => button('Continue to Captain bidding').click());
    expect(commands[0]).toMatchObject({ type: 'live.transition_stage', stageId: 'captains' });
    expect(commands[0]?.reason).toContain('later ordinary selection rights remain pending');
  });
  it('records a Chief-directed acting role only after member, duty, reason and review are complete', async () => {
    live.admin_override_allowed = true;
    live.admin_override_member_ids = [17, 9];
    live.admin_override_position_ids = ['S-A', 'S-B', 'R-A'];
    live.available_non_biddable_positions = [];
    live.exceptional_assignments = [];
    await mount();
    await settle(() => button('Temporary duties').click());
    expect(button('Review temporary duty').disabled).toBe(true);
    await choose('Directed-role member', '9');
    await fill('Directed role label', 'Acting Division Chief of Prevention');
    await fill('Operator reason', 'Synthetic Chief direction reviewed');
    expect(button('Review temporary duty').disabled).toBe(true);
    await settle(() =>
      (
        container.querySelector(
          'input[aria-label="I reviewed the directed role"]',
        ) as HTMLInputElement
      ).click(),
    );
    await settle(() => button('Review temporary duty').click());
    expect(commands).toHaveLength(0);
    await settle(() =>
      (
        container.querySelector('input[aria-label="I reviewed temporary duty"]') as HTMLInputElement
      ).click(),
    );
    await settle(() => button('Confirm temporary duty').click());
    expect(commands[0]).toMatchObject({
      type: 'live.set_exceptional_assignment',
      operation: 'ASSIGN',
      memberId: 9,
      roleLabel: 'Acting Division Chief of Prevention',
      reason: 'Synthetic Chief direction reviewed',
    });
    expect(commands[0]).not.toHaveProperty('aDay');
    expect(commands[0]).not.toHaveProperty('positionId');
  });
  it.each(['CPT', 'LT', 'FF'] as const)(
    'prompts %s priority, awards a related seat without A-Day, returns requester, and prompts due A-Day',
    async (selectedRank) => {
      rank = selectedRank;
      await mount();
      const seat = [...container.querySelectorAll('button')].find((node) =>
        node.textContent?.includes('S-A'),
      );
      await settle(() => seat?.click());
      await vi.waitFor(() =>
        expect(container.textContent).toContain('Other members have priority for Investigator'),
      );
      expect(container.textContent).toContain(`${rank} Synthetic Qualified Candidate · 10 points`);
      expect(button('Confirm bid').disabled).toBe(true);
      expect(commands).toHaveLength(0);
      await settle(() => button('Offer specialty seats first').click());
      expect(container.querySelector('[data-panel-title="Specialty and contact"]')).not.toBeNull();
      await choose('Specialty seat to offer', 'S-B');
      expect(container.textContent).toContain('A-Day deferred automatically');
      await settle(() => button('ACCEPT').click());
      expect(commands[1]).toMatchObject({
        type: 'live.resolve_specialty_candidate',
        memberId: 9,
        positionId: 'S-B',
        outcome: 'ACCEPT',
      });
      expect(commands[1]).not.toHaveProperty('aDay');
      const regular = [...container.querySelectorAll('button')].find((node) =>
        node.textContent?.includes('R-A'),
      );
      await settle(() => regular?.click());
      await choose('Selection A-Day', 'G1');
      await settle(() => button('Confirm bid').click());
      expect(commands[2]).toMatchObject({
        type: 'live.record_selection',
        memberId: 17,
        positionId: 'R-A',
        aDay: 'G1',
      });
      expect(container.textContent).toContain('is now due to select an A-Day');
      expect(
        container.querySelector('[data-panel-title="Record controlled A-Day selection"]'),
      ).not.toBeNull();
      await choose('Controlled A-Day', 'G2');
      await settle(() => button('Commit controlled A-Day').click());
      expect(commands[3]).toMatchObject({ type: 'live.record_a_day', memberId: 9, aDay: 'G2' });
    },
  );
  it.each([true, false])(
    'offers all-profile advisory candidates in Mock=%s without inventing an interruption or blocking the original bidder',
    async (isMock) => {
      advisoryReview = true;
      live.specialties = [];
      live.specialty_review_position_ids = ['S-A', 'S-B'];
      live.admin_override_allowed = true;
      live.admin_override_member_ids = [17, 9];
      live.admin_override_position_ids = ['S-A', 'S-B', 'R-A'];
      await mount(isMock);
      const seat = [...container.querySelectorAll('button')].find((node) =>
        node.textContent?.includes('S-A'),
      );
      await settle(() => seat?.click());
      expect(container.textContent).toContain('Higher-scoring eligible members');
      expect(container.textContent).toContain('10 points');
      expect(container.textContent).toContain('Related eligible seats (2)');
      expect(container.textContent).not.toContain('Offer specialty seats first');
      await settle(() => button('Assign Synthetic Qualified Candidate').click());
      expect(operator.requestOverride).toHaveBeenCalledWith('S-A', 9, true);
      expect(operator.setActiveMember).toHaveBeenLastCalledWith(17);
      expect(commands).toHaveLength(0);
    },
  );
  it('keeps specialty confirmation blocked when priority cannot be checked and provides a safe retry', async () => {
    reviewFailure = true;
    await mount();
    const seat = [...container.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('S-A'),
    );
    await settle(() => seat?.click());
    expect(button('Confirm bid').disabled).toBe(true);
    expect(container.textContent).toContain('Specialty priority could not be checked');
    reviewFailure = false;
    await settle(() => button('Retry specialty review').click());
    expect(container.textContent).toContain('Other members have priority for Investigator');
    expect(commands).toHaveLength(0);
  });
  it('shows a 10-qualified / 5-open Driver Engineer warning in the primary workspace', async () => {
    live.credential_coverage = {
      availability: 'AVAILABLE',
      source: 'FROZEN_SESSION_SNAPSHOT',
      groups: [
        {
          id: 'driver-engineer',
          label: 'Driver Engineer',
          remaining_seat_count: 5,
          eligible_member_ids: Array.from({ length: 10 }, (_, index) => index + 1),
          eligible_member_count: 10,
          buffer: 5,
          status: 'LOW_BUFFER',
          critical_member_ids: [],
        },
      ],
    };
    await mount();
    expect(container.querySelector('[data-testid="credential-coverage-advisory"]')).not.toBeNull();
    expect(container.textContent).toContain('10 qualified members left for 5 open seats');
    expect(commands).toHaveLength(0);
  });
});
