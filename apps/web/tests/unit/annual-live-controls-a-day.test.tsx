// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PositionMeta } from '../../app/_components/bid/types';
import { AnnualLiveControls } from '../../app/admin/bid/_components/AnnualLiveControls';

vi.mock('@/components/admin/TaskPanel', () => ({
  TaskPanel: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

const candidate = { member_id: 17, first_name: 'Synthetic', last_name: 'Member', rank: 'FF' };
const positions: PositionMeta[] = [
  {
    id: 'abc',
    shift: 'A',
    station: '1',
    unit: 'Synthetic',
    rankRequired: 'FF',
    positionName: 'ABC seat',
  },
  {
    id: 'days',
    shift: 'D',
    station: '1',
    unit: 'Synthetic',
    rankRequired: 'FF',
    positionName: 'Days seat',
  },
];
let root: Root | undefined;
let container: HTMLDivElement;
let originalWindowFetch: typeof fetch;
let commands: Record<string, unknown>[];
let failCommand: boolean;
let live: ReturnType<typeof state>;
function fallback(mode: 'VOLUNTARY' | 'FORCED' = 'VOLUNTARY') {
  return {
    ok: true as const,
    pool: null as { poolId: string } | null,
    positionId: 'abc',
    policyId: 'synthetic-policy',
    label: 'Synthetic fallback',
    sourceRef: 'Synthetic source clause 4',
    sourceDecisionId: 'synthetic-reviewed-decision',
    tierId: 'synthetic-tier',
    tierLabel: 'Synthetic active tier',
    mode,
    candidateMemberIds: [17, 9],
    eligibleMemberIds: [17, 9, 23],
    exhausted: [
      { tierId: 'earlier-tier', eligibleMemberIds: [], reason: 'NO_ELIGIBLE_AVAILABLE_CANDIDATES' },
    ],
    comparator: [{ key: 'rsc_seniority', direction: 'DESC' }],
  };
}
function state(simultaneous = true, active = false) {
  return {
    sequence: 4,
    a_day_selection: simultaneous ? 'SIMULTANEOUS' : null,
    current_phase: 'position_bid' as
      | 'config'
      | 'position_bid'
      | 'a_day_bid'
      | 'paused'
      | 'complete',
    a_day_timing_by_position: {} as Record<string, 'SIMULTANEOUS' | 'AFTER_POSITION_SELECTION'>,
    a_day_current: null as {
      member_id: number;
      position_id: string;
      shift: 'A' | 'B' | 'C' | 'D';
      eligible_a_days: readonly string[];
    } | null,
    current_bidder: candidate,
    dispositions: [
      {
        disposition: 'DEFER' as const,
        advances: true,
        returns: false,
        retainsLaterSelectionRights: true,
        terminal: false,
        requiresReason: true,
        requiresEvidence: false,
      },
      {
        disposition: 'DECLINED' as const,
        advances: true,
        returns: false,
        retainsLaterSelectionRights: false,
        terminal: false,
        requiresReason: true,
        requiresEvidence: false,
      },
      {
        disposition: 'UNREACHABLE' as const,
        advances: true,
        returns: false,
        retainsLaterSelectionRights: true,
        terminal: false,
        requiresReason: true,
        requiresEvidence: true,
      },
    ],
    unresolved_members: [] as Array<typeof candidate>,
    returning_member: null as typeof candidate | null,
    term_participation: {} as Record<
      string,
      {
        assignmentId: string;
        sourceRef: string;
        protected: boolean;
        memberMayLeave: true;
        voluntaryOnly: true;
      }
    >,
    remaining_order: [17],
    fills: { original: { member_id: 17 } },
    specialties: [],
    opportunity_pools: [] as Array<{
      id: string;
      label: string;
      kind: 'STATION_POOL' | 'FLOAT_POOL';
      sourceRef: string;
      sourceDecisionId: string;
      positionIds: string[];
      resolvedPositionId: string | null;
      capacity: number;
      remaining: number;
      valid: boolean;
      code: string | null;
      shift: string;
    }>,
    fallbacks: [] as Array<
      | ReturnType<typeof fallback>
      | {
          ok: false;
          positionId: string;
          policyId: string;
          label: string;
          sourceRef: string;
          code: string;
        }
    >,
    active: active
      ? {
          specialty_id: 'synthetic',
          specialty_label: 'Synthetic specialty',
          requested_position_id: 'days',
          original_bidder: candidate,
          candidates: [candidate],
          current_candidate_id: 17,
          remaining_candidate_ids: [17],
          suspended_turn: true,
          resume: { member_id: 17, queue_cursor: 0, current_phase: 'position_bid' },
        }
      : null,
  };
}
function response(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}
beforeEach(() => {
  originalWindowFetch = window.fetch;
  commands = [];
  failCommand = false;
  live = state();
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/specialty-live')) return response(live);
    if (url === '/api/auth/csrf')
      return response({ token: 'csrf_00000000-0000-0000-0000-000000000001' });
    if (url.endsWith('/commands/live')) {
      commands.push(JSON.parse(String(init?.body)));
      if (failCommand) throw new Error('Synthetic uncertain transport');
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
function button(text: string) {
  const result = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!result) throw new Error(`Missing button ${text}`);
  return result;
}
function select(label: string) {
  const result = container.querySelector(`select[aria-label="${label}"]`);
  if (!result) throw new Error(`Missing select ${label}`);
  return result as unknown as HTMLSelectElement;
}
async function choose(label: string, value: string) {
  await settle(() => {
    const node = select(label);
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function fill(labelText: string, value: string) {
  await settle(() => {
    const input = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes(labelText))
      ?.querySelector('input');
    if (!input) throw new Error(`Missing input ${labelText}`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function mount(panel: string, positionList = positions) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await settle(() =>
    root?.render(
      <AnnualLiveControls
        bidSessionId="synthetic"
        isMock={false}
        currentBidderId={17}
        bidOrder={[{ memberId: 17 }]}
        fills={{ original: { memberId: 17 } }}
        members={{
          '17': {
            id: 17,
            firstName: 'Synthetic',
            lastName: 'First',
            rank: 'FF',
            employeeId: 'synthetic-17',
          },
          '9': {
            id: 9,
            firstName: 'Synthetic',
            lastName: 'Second',
            rank: 'FF',
            employeeId: 'synthetic-9',
          },
        }}
        positions={positionList}
      />,
    ),
  );
  await settle(() => button(panel).click());
  await settle(() => {
    const input = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Operator reason'))
      ?.querySelector('input');
    if (!input) throw new Error('Missing operator reason');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      input,
      'Synthetic reviewed award',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('simultaneous A-Day live awards', () => {
  it('requires a fresh explicit voluntary departure election and preserves it on an uncertain retry', async () => {
    live.term_participation['17'] = {
      assignmentId: 'source-assignment',
      sourceRef: 'Synthetic reviewed term',
      protected: true,
      memberMayLeave: true,
      voluntaryOnly: true,
    };
    await mount('Record selection');
    await choose('Position selected by current bidder', 'abc');
    await choose('Selection A-Day', 'G2');
    await settle(() => button('Commit selection').click());
    expect(commands).toEqual([]);
    expect(container.textContent).toContain('explicit voluntary departure');
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    await settle(() => checkbox.click());
    await settle(() => button('Commit selection').click());
    expect(commands).toEqual([]);
    await settle(() => {
      const input = [...container.querySelectorAll('label')]
        .find((label) => label.textContent?.includes('Voluntary departure evidence'))
        ?.querySelector('input');
      if (!input) throw new Error('Missing departure evidence');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'Synthetic member choice record',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    failCommand = true;
    await settle(() => button('Commit selection').click());
    await settle(() => button('Commit selection').click());
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(commands[0]).toMatchObject({
      termDeparture: {
        assignmentId: 'source-assignment',
        memberConfirmed: true,
        evidenceReference: 'Synthetic member choice record',
      },
    });
    await choose('Position selected by current bidder', 'days');
    expect(checkbox.checked).toBe(false);
  });

  it('offers one explicit pool and sends only its server-resolved capacity slot with the pool identity', async () => {
    live.opportunity_pools = [
      {
        id: 'pool',
        label: 'Synthetic station pool',
        kind: 'STATION_POOL',
        sourceRef: 'Synthetic reviewed source',
        sourceDecisionId: 'decision',
        positionIds: ['abc'],
        resolvedPositionId: 'abc',
        capacity: 2,
        remaining: 1,
        valid: true,
        code: null,
        shift: 'A',
      },
    ];
    await mount('Record selection');
    expect(
      [...select('Position selected by current bidder').options].some(
        (option) => option.value === 'abc',
      ),
    ).toBe(false);
    await choose('Station or float pool', 'pool');
    expect(container.textContent).toContain('Synthetic reviewed source');
    expect(button('Commit selection').disabled).toBe(true);
    await choose('Selection A-Day', 'G2');
    await settle(() => button('Commit selection').click());
    expect(commands[0]).toMatchObject({
      type: 'live.record_selection',
      positionId: 'abc',
      pool: { poolId: 'pool' },
      aDay: 'G2',
    });
  });

  it('sends pool identity on corrections and disables unavailable pool options', async () => {
    live.opportunity_pools = [
      {
        id: 'pool',
        label: 'Synthetic station pool',
        kind: 'STATION_POOL',
        sourceRef: 'Synthetic reviewed source',
        sourceDecisionId: 'decision',
        positionIds: ['abc'],
        resolvedPositionId: 'abc',
        capacity: 1,
        remaining: 1,
        valid: true,
        code: null,
        shift: 'A',
      },
      {
        id: 'full',
        label: 'Exhausted capacity',
        kind: 'FLOAT_POOL',
        sourceRef: 'Synthetic reviewed source',
        sourceDecisionId: 'decision',
        positionIds: [],
        resolvedPositionId: null,
        capacity: 1,
        remaining: 0,
        valid: true,
        code: null,
        shift: 'A',
      },
    ];
    await mount('Correct selection');
    expect(
      [...select('Corrected station or float pool').options].find(
        (option) => option.value === 'full',
      )?.disabled,
    ).toBe(true);
    await choose('Original filled opportunity', 'original');
    await choose('Corrected station or float pool', 'pool');
    await choose('Corrected selection A-Day', 'G3');
    await settle(() => button('Amend opportunity').click());
    expect(commands[0]).toMatchObject({
      type: 'live.amend_selection',
      toPositionId: 'abc',
      pool: { poolId: 'pool' },
      aDay: 'G3',
    });
  });

  it('requires an explicit shift-appropriate choice and sends it with a selection', async () => {
    await mount('Record selection');
    await choose('Position selected by current bidder', 'abc');
    expect(select('Selection A-Day').value).toBe('');
    expect([...select('Selection A-Day').options].map((option) => option.value)).toEqual([
      '',
      'G1',
      'G2',
      'G3',
      'G4',
    ]);
    expect(button('Commit selection').disabled).toBe(true);
    await choose('Selection A-Day', 'G2');
    await choose('Position selected by current bidder', 'days');
    expect(select('Selection A-Day').value).toBe('');
    expect([...select('Selection A-Day').options].map((option) => option.value)).toEqual([
      '',
      'MON',
      'TUE',
      'WED',
      'THU',
      'FRI',
      'SAT',
      'SUN',
    ]);
    expect(button('Commit selection').disabled).toBe(true);
    await choose('Selection A-Day', 'WED');
    await settle(() => button('Commit selection').click());
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: 'live.record_selection',
      memberId: 17,
      positionId: 'days',
      aDay: 'WED',
    });
    expect(select('Selection A-Day').value).toBe('');
  });

  it('requires a new explicit A-Day for an amended award', async () => {
    await mount('Correct selection');
    await choose('Original filled opportunity', 'original');
    await choose('New open opportunity', 'abc');
    expect(button('Amend opportunity').disabled).toBe(true);
    await choose('Corrected selection A-Day', 'G3');
    await settle(() => button('Amend opportunity').click());
    expect(commands[0]).toMatchObject({
      type: 'live.amend_selection',
      fromPositionId: 'original',
      toPositionId: 'abc',
      aDay: 'G3',
    });
  });

  it('requires A-Day only for specialty acceptance and leaves other resolutions available', async () => {
    live = state(true, true);
    await mount('Specialty and contact');
    expect(button('ACCEPT').disabled).toBe(true);
    expect(button('DECLINE').disabled).toBe(false);
    await settle(() => button('DECLINE').click());
    expect(commands[0]).toMatchObject({
      type: 'live.resolve_specialty_candidate',
      outcome: 'DECLINE',
    });
    expect(commands[0]).not.toHaveProperty('aDay');
    await choose('Specialty award A-Day', 'FRI');
    await settle(() => button('ACCEPT').click());
    expect(commands[1]).toMatchObject({
      type: 'live.resolve_specialty_candidate',
      outcome: 'ACCEPT',
      aDay: 'FRI',
    });
  });

  it('keeps all known choices when specialty position metadata is unavailable', async () => {
    live = state(true, true);
    await mount('Specialty and contact', []);
    expect([...select('Specialty award A-Day').options].map((option) => option.value)).toEqual([
      '',
      'G1',
      'G2',
      'G3',
      'G4',
      'MON',
      'TUE',
      'WED',
      'THU',
      'FRI',
      'SAT',
      'SUN',
    ]);
    expect(button('ACCEPT').disabled).toBe(true);
  });

  it('does not show or submit an A-Day when the server does not enable simultaneous selection', async () => {
    live = state(false);
    await mount('Record selection');
    await choose('Position selected by current bidder', 'abc');
    expect(container.querySelector('select[aria-label="Selection A-Day"]')).toBeNull();
    expect(button('Commit selection').disabled).toBe(false);
    await settle(() => button('Commit selection').click());
    expect(commands).toHaveLength(1);
    expect(commands[0]).not.toHaveProperty('aDay');
  });

  it('uses a source-backed position timing exception instead of the global default', async () => {
    live = { ...state(true), a_day_timing_by_position: { abc: 'AFTER_POSITION_SELECTION' } };
    await mount('Record selection');
    await choose('Position selected by current bidder', 'abc');
    expect(container.querySelector('select[aria-label="Selection A-Day"]')).toBeNull();
    await settle(() => button('Commit selection').click());
    expect(commands[0]).toMatchObject({ type: 'live.record_selection', positionId: 'abc' });
    expect(commands[0]).not.toHaveProperty('aDay');
  });

  it('records a Timeline-controlled A-Day as its own canonical operator command', async () => {
    live = {
      ...state(false),
      current_phase: 'a_day_bid',
      a_day_current: {
        member_id: 17,
        position_id: 'abc',
        shift: 'A',
        eligible_a_days: ['G1', 'G3'],
      },
    };
    await mount('Record A-Day');
    expect(button('Commit controlled A-Day').disabled).toBe(true);
    await choose('Controlled A-Day', 'G2');
    expect(button('Commit controlled A-Day').disabled).toBe(true);
    await choose('Controlled A-Day', 'G3');
    await settle(() => button('Commit controlled A-Day').click());
    expect(commands[0]).toMatchObject({
      type: 'live.record_a_day',
      memberId: 17,
      aDay: 'G3',
    });
  });

  it('retries the same A-Day with the same command identity and gives a changed choice a new identity', async () => {
    failCommand = true;
    await mount('Record selection');
    await choose('Position selected by current bidder', 'abc');
    await choose('Selection A-Day', 'G1');
    await settle(() => button('Commit selection').click());
    await settle(() => button('Commit selection').click());
    expect(commands[1]).toEqual(commands[0]);
    await choose('Selection A-Day', 'G4');
    await settle(() => button('Commit selection').click());
    expect(commands[2]).toMatchObject({ aDay: 'G4' });
    expect(commands[2]?.commandId).not.toBe(commands[0]?.commandId);
  });
});

describe('canonical disposition and return controls', () => {
  it('records contact, defer, and evidence-gated unreachable commands', async () => {
    await mount('Disposition and return');
    await settle(() => button('Record PHONE').click());
    await settle(() => button('Record DEFER').click());
    expect(button('Record UNREACHABLE').disabled).toBe(true);
    await fill('Evidence reference', 'Mock contact log 2026-09-24');
    await settle(() => button('Record UNREACHABLE').click());

    expect(commands[0]).toMatchObject({
      type: 'live.record_contact_attempt',
      memberId: 17,
      method: 'PHONE',
    });
    expect(commands[1]).toMatchObject({ type: 'live.disposition', disposition: 'DEFER' });
    expect(commands[2]).toMatchObject({
      type: 'live.disposition',
      disposition: 'UNREACHABLE',
      evidenceReference: 'Mock contact log 2026-09-24',
    });
  });

  it('returns an unresolved member and records that member selection at the current sequence', async () => {
    const returned = {
      member_id: 9,
      first_name: 'Synthetic',
      last_name: 'Return',
      rank: 'FF',
    };
    live.unresolved_members = [returned];
    await mount('Disposition and return');
    await settle(() => button('Return FF Synthetic Return').click());
    expect(commands[0]).toMatchObject({
      type: 'live.return_at_current_sequence',
      memberId: 9,
    });

    await act(async () => root?.unmount());
    root = undefined;
    commands = [];
    live = { ...state(), returning_member: returned };
    await mount('Record selection');
    await choose('Position selected by current bidder', 'abc');
    await choose('Selection A-Day', 'G2');
    await settle(() => button('Commit selection').click());
    expect(commands[0]).toMatchObject({
      type: 'live.record_selection',
      memberId: 9,
      positionId: 'abc',
      aDay: 'G2',
    });
  });
});

describe('server-ordered fallback awards', () => {
  const key = JSON.stringify(['synthetic-policy', 'abc']);
  it('refuses to force a member whose frozen term right permits only voluntary departure', async () => {
    live.term_participation['17'] = {
      assignmentId: 'source-assignment',
      sourceRef: 'Synthetic reviewed term',
      protected: true,
      memberMayLeave: true,
      voluntaryOnly: true,
    };
    live.fallbacks = [fallback('FORCED')];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await mount('Fallback awards');
    await choose('Fallback opportunity', key);
    await choose('Fallback award A-Day', 'G2');
    await settle(() => button('Confirm forced award').click());
    expect(commands).toEqual([]);
    expect(container.textContent).toContain('only by an explicit voluntary choice');
  });
  it('shows source, exhaustion and server order, then accepts only the first voluntary candidate', async () => {
    live.fallbacks = [fallback()];
    await mount('Fallback awards');
    await choose('Fallback opportunity', key);
    expect(container.textContent).toContain('Source clause: Synthetic source clause 4');
    expect(container.textContent).toContain('Active tier: Synthetic active tier');
    expect(container.textContent).toContain('earlier-tier · no eligible available candidates');
    expect(container.textContent).toContain('rsc seniority (DESC)');
    expect(
      [...container.querySelectorAll('ol[aria-label="Ordered fallback candidates"] li')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['FF Synthetic First', 'FF Synthetic Second']);
    expect(button('Record voluntary acceptance').disabled).toBe(true);
    await choose('Fallback award A-Day', 'G2');
    await settle(() => button('Record voluntary acceptance').click());
    expect(commands[0]).toMatchObject({
      type: 'live.record_selection',
      memberId: 17,
      positionId: 'abc',
      fallback: { policyId: 'synthetic-policy', tierId: 'synthetic-tier' },
      aDay: 'G2',
    });
  });

  it('records voluntary contact and responses without requiring or sending an A-Day', async () => {
    live.fallbacks = [fallback()];
    await mount('Fallback awards');
    await choose('Fallback opportunity', key);
    await settle(() => button('Record fallback PHONE').click());
    await settle(() => button('Record fallback decline').click());
    await settle(() => button('Record fallback unreachable').click());
    expect(commands[0]).toMatchObject({
      type: 'live.record_contact_attempt',
      memberId: 17,
      method: 'PHONE',
    });
    expect(commands[1]).toMatchObject({
      type: 'live.record_fallback_response',
      memberId: 17,
      positionId: 'abc',
      fallback: { policyId: 'synthetic-policy', tierId: 'synthetic-tier' },
      outcome: 'DECLINE',
    });
    expect(commands[2]).toMatchObject({
      type: 'live.record_fallback_response',
      memberId: 17,
      outcome: 'UNREACHABLE',
    });
    for (const command of commands) expect(command).not.toHaveProperty('aDay');
  });

  it('requires confirmation for the first forced candidate and offers no response that skips that candidate', async () => {
    live.fallbacks = [{ ...fallback('FORCED'), pool: { poolId: 'synthetic-pool' } }];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await mount('Fallback awards');
    await choose('Fallback opportunity', key);
    await choose('Fallback award A-Day', 'G4');
    expect([...container.querySelectorAll('button')].map((node) => node.textContent)).not.toContain(
      'Record fallback decline',
    );
    expect([...container.querySelectorAll('button')].map((node) => node.textContent)).not.toContain(
      'Record fallback unreachable',
    );
    await settle(() => button('Confirm forced award').click());
    expect(commands).toEqual([]);
    expect(confirm).toHaveBeenCalledWith(
      'Confirm forced award to FF Synthetic First for abc under Synthetic active tier, A-Day G4?',
    );
    confirm.mockReturnValue(true);
    await settle(() => button('Confirm forced award').click());
    expect(commands[0]).toMatchObject({
      type: 'live.force_selection',
      pool: { poolId: 'synthetic-pool' },
      memberId: 17,
      positionId: 'abc',
      aDay: 'G4',
      fallback: { policyId: 'synthetic-policy', tierId: 'synthetic-tier' },
    });
  });

  it('keeps unavailable fallback material read-only', async () => {
    live.fallbacks = [
      {
        ok: false,
        positionId: 'abc',
        policyId: 'synthetic-policy',
        label: 'Synthetic fallback',
        sourceRef: 'Synthetic clause',
        code: 'FALLBACK_CURRENT_ASSIGNMENT_EVIDENCE_MISSING',
      },
    ];
    await mount('Fallback awards');
    await choose('Fallback opportunity', key);
    expect(container.textContent).toContain(
      'Fallback unavailable: FALLBACK_CURRENT_ASSIGNMENT_EVIDENCE_MISSING',
    );
    expect(container.querySelector('ol[aria-label="Ordered fallback candidates"]')).toBeNull();
    expect(commands).toEqual([]);
  });

  it('uses refreshed server progression and clears the prior candidate’s A-Day choice', async () => {
    live.fallbacks = [fallback()];
    await mount('Fallback awards');
    await choose('Fallback opportunity', key);
    await choose('Fallback award A-Day', 'G1');
    live.fallbacks = [{ ...fallback(), candidateMemberIds: [9] }];
    await settle(() => button('Record fallback decline').click());
    expect(container.textContent).toContain('Next candidate: FF Synthetic Second');
    expect(select('Fallback award A-Day').value).toBe('');
    expect(button('Record voluntary acceptance').disabled).toBe(true);
    await choose('Fallback award A-Day', 'G3');
    await settle(() => button('Record voluntary acceptance').click());
    expect(commands[1]).toMatchObject({ type: 'live.record_selection', memberId: 9, aDay: 'G3' });
  });
});
