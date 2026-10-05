// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberLite, PositionMeta } from '../../app/_components/bid/types';
import { AdministratorOverride } from '../../app/admin/bid/_components/AdministratorOverride';

vi.mock('@/components/admin/TaskPanel', () => ({
  TaskPanel: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const members: Record<string, MemberLite> = {
  '17': { id: 17, firstName: 'First', lastName: 'Captain', rank: 'CPT', employeeId: 'fixture17' },
  '18': {
    id: 18,
    firstName: 'Waiting',
    lastName: 'Lieutenant',
    rank: 'LT',
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
      sourceName: 'Synthetic explicit evidence',
      sourceSha256: null,
      sourceLocation: null,
      archiveSha256: null,
    },
  },
  '19': {
    id: 19,
    firstName: 'Waiting',
    lastName: 'Firefighter',
    rank: 'FF',
    employeeId: 'fixture19',
  },
  '20': { id: 20, firstName: 'Excluded', lastName: 'Person', rank: 'FF', employeeId: 'fixture20' },
};
const positions: PositionMeta[] = [
  {
    id: 'D101',
    shift: 'D',
    station: 'Days',
    unit: 'Prevention',
    rankRequired: 'CPT',
    positionName: 'Days Captain',
  },
  {
    id: 'A101',
    shift: 'A',
    station: 'Station 1',
    unit: 'Ladder 1',
    rankRequired: 'CPT',
    positionName: 'Combat Captain',
  },
  {
    id: 'B105',
    shift: 'B',
    station: 'Station 1',
    unit: 'Engine 1',
    rankRequired: 'LT',
    positionName: 'Combat Lieutenant',
  },
  {
    id: 'C103',
    shift: 'C',
    station: 'Station 1',
    unit: 'Ladder 1',
    rankRequired: 'FF',
    positionName: 'Firefighter',
  },
  {
    id: 'closed',
    shift: 'A',
    station: 'Station 2',
    unit: 'Engine 2',
    rankRequired: 'FF',
    positionName: 'Reserved',
    bidParticipation: 'RESERVED_NON_BIDDABLE',
  },
];
const warnings = [
  {
    code: 'ADMIN_OVERRIDE_OUT_OF_TURN',
    message: 'This member is selecting out of the ordinary order.',
  },
  {
    code: 'ADMIN_OVERRIDE_STAGE',
    message: 'This opportunity is outside the current Days Captain stage.',
  },
  {
    code: 'ADMIN_OVERRIDE_QUALIFICATION',
    message: 'Frozen qualification evidence does not meet this opportunity.',
  },
];
let root: Root | undefined;
let container: HTMLDivElement;
let originalWindowFetch: typeof fetch;
let previews: Record<string, unknown>[];
let commands: Record<string, unknown>[];
let previewIdentityWrong: boolean;
let failCommandOnce: boolean;
let props: Parameters<typeof AdministratorOverride>[0];
let canonicalChange: ReturnType<typeof vi.fn<() => void>>;
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
beforeEach(() => {
  originalWindowFetch = window.fetch;
  previews = [];
  commands = [];
  previewIdentityWrong = false;
  failCommandOnce = false;
  canonicalChange = vi.fn<() => void>();
  props = {
    bidSessionId: 'isolated-synthetic',
    allowed: true,
    memberIds: [17, 18, 19, 19],
    positionIds: ['D101', 'A101', 'B105', 'C103'],
    opportunityPools: [],
    members,
    positions,
    fills: {},
    sequence: 4,
    currentMemberId: 17,
    currentStage: 'Days Captain selection',
    currentStageId: 'days-captains',
    combatGroups: ['G1', 'G2', 'G3', 'G4'],
    aDayTiming: {},
    defaultADayTiming: 'SIMULTANEOUS',
    termParticipation: {},
    commandsBlocked: false,
    onCanonicalChange: canonicalChange,
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/auth/csrf')
      return response({ token: 'csrf_00000000-0000-0000-0000-000000000001' });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (url.endsWith('/commands/live/preview')) {
      previews.push(body);
      return response({
        valid: true,
        expectedSeq: body.expectedSeq,
        memberId: previewIdentityWrong ? 19 : body.memberId,
        ...(body.positionId ? { positionId: body.positionId } : {}),
        ...(body.type === 'live.record_a_day'
          ? {
              positionId: Object.entries(props.fills).find(
                ([, fill]) => fill.member_id === body.memberId,
              )?.[0],
            }
          : {}),
        warnings,
        nextMemberId: 17,
        ...(body.deferStageId
          ? { deferredStageId: body.deferStageId, deferredMemberIds: [17, 18, 19] }
          : {}),
      });
    }
    if (url.endsWith('/commands/live')) {
      commands.push(body);
      if (failCommandOnce) {
        failCommandOnce = false;
        throw new Error('Synthetic response lost.');
      }
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
async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await settle(() => root?.render(<AdministratorOverride {...props} />));
}
function button(text: string) {
  const node = [...container.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(text),
  );
  if (!node) throw new Error(`Missing button ${text}`);
  return node;
}
async function select(label: string, value: string) {
  await settle(() => {
    const node = container.querySelector(
      `select[aria-label="${label}"]`,
    ) as unknown as HTMLSelectElement;
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function input(label: string, value: string) {
  await settle(() => {
    const node = container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function draftAward(memberId = '18', positionId = 'A101') {
  await settle(() => button('Adjust bid').click());
  await select('Administrator override member', memberId);
  await select('Administrator override open position', positionId);
  await select('Administrator override A-Day', positionId.startsWith('D') ? 'MON' : 'G2');
  await input('Note (optional)', 'Synthetic administrator direction');
}
async function reviewAndAcknowledge() {
  await settle(() => button('Review adjustment').click());
  await settle(() =>
    (
      container.querySelector(
        'input[aria-label="I acknowledge the override advisories"]',
      ) as HTMLInputElement
    ).click(),
  );
}
describe('audited administrator override', () => {
  it('marks an explicitly forced award in both preview and confirmed command, while requiring advisory acknowledgement', async () => {
    await mount();
    await draftAward('19', 'C103');
    await settle(() =>
      (
        container.querySelector('input[aria-label="Mark as forced assignment"]') as HTMLInputElement
      ).click(),
    );
    await reviewAndAcknowledge();
    expect(previews[0]).toMatchObject({
      type: 'live.record_selection',
      forced: true,
      memberId: 19,
      positionId: 'C103',
    });
    expect(commands).toHaveLength(0);
    expect(container.textContent).toContain('Forced award');
    await settle(() => button('Confirm administrator selection').click());
    expect(commands[0]).toMatchObject({
      type: 'live.record_selection',
      forced: true,
      memberId: 19,
      adminOverride: { acknowledged: true },
    });
    expect(container.textContent).toContain('Forced assignment recorded and marked');
  });
  it('binds the resolved pooled opening to the same pool ID in preview and confirmation', async () => {
    props = {
      ...props,
      opportunityPools: [
        { id: 'synthetic-combat-float', positionIds: ['C103'], resolvedPositionId: 'C103' },
      ],
    };
    await mount();
    await draftAward('19', 'C103');
    await reviewAndAcknowledge();
    expect(previews[0]).toMatchObject({
      positionId: 'C103',
      pool: { poolId: 'synthetic-combat-float' },
    });
    expect(commands).toHaveLength(0);
    await settle(() => button('Confirm administrator selection').click());
    expect(commands[0]).toMatchObject({
      positionId: 'C103',
      pool: { poolId: 'synthetic-combat-float' },
    });
  });
  it('permits a pending A-Day member to be skipped without requiring a correction', async () => {
    props = { ...props, fills: { A101: { member_id: 17 } } };
    await mount();
    await settle(() => button('Adjust bid').click());
    await select('Administrator override action', 'SKIP');
    await input('Note (optional)', 'Member will choose A-Day later');
    expect(button('Review adjustment').disabled).toBe(false);
    expect(container.textContent).not.toContain('already holds A101');
    await reviewAndAcknowledge();
    await settle(() => button('Confirm skip for now').click());
    expect(commands[0]).toMatchObject({
      type: 'live.disposition',
      memberId: 17,
      disposition: 'SKIP',
    });
  });
  it('requires the member’s voluntary term election and evidence and binds them to the exact member', async () => {
    props = {
      ...props,
      termParticipation: {
        '18': { assignmentId: 'synthetic-term18', sourceRef: 'Reviewed synthetic term' },
      },
    };
    await mount();
    await draftAward();
    expect(button('Review adjustment').disabled).toBe(true);
    expect(previews).toHaveLength(0);
    await settle(() =>
      (
        container.querySelector(
          'input[aria-label="Member confirms voluntary term departure"]',
        ) as HTMLInputElement
      ).click(),
    );
    expect(button('Review adjustment').disabled).toBe(true);
    await input('Voluntary departure evidence', 'Member explicitly elected another assignment');
    await reviewAndAcknowledge();
    expect(previews[0]).toMatchObject({
      termDeparture: {
        assignmentId: 'synthetic-term18',
        memberConfirmed: true,
        evidenceReference: 'Member explicitly elected another assignment',
      },
    });
    await select('Administrator override member', '19');
    expect(container.textContent).not.toContain('Member explicitly chose to leave');
    expect(container.textContent).not.toContain('Confirm administrator selection');
    expect(commands).toHaveLength(0);
  });
  it('hides override controls without server-granted authority', async () => {
    props.allowed = false;
    await mount();
    expect(container.textContent).not.toContain('Administrator override');
    expect(previews).toHaveLength(0);
    expect(commands).toHaveLength(0);
  });
  it('allows any frozen member and open rank/shift with advisory preview, then requires explicit confirmation', async () => {
    await mount();
    await draftAward();
    expect(container.textContent).toContain('No previous bid or assignment.');
    expect(previews).toHaveLength(0);
    expect(commands).toHaveLength(0);
    await settle(() => button('Review adjustment').click());
    expect(previews[0]).toMatchObject({
      type: 'live.record_selection',
      memberId: 18,
      positionId: 'A101',
      aDay: 'G2',
      expectedSeq: 4,
    });
    expect(container.textContent).toContain(
      'Frozen qualification evidence does not meet this opportunity.',
    );
    expect(button('Confirm administrator selection').disabled).toBe(true);
    expect(commands).toHaveLength(0);
    await settle(() =>
      (
        container.querySelector(
          'input[aria-label="I acknowledge the override advisories"]',
        ) as HTMLInputElement
      ).click(),
    );
    expect(commands).toHaveLength(0);
    await settle(() => button('Confirm administrator selection').click());
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      memberId: 18,
      positionId: 'A101',
      reason: 'Synthetic administrator direction',
      adminOverride: { acknowledged: true, warningCodes: warnings.map((warning) => warning.code) },
    });
    expect(canonicalChange).toHaveBeenCalledOnce();
  });
  it('requires a valid A-Day while allowing an empty or short optional note', async () => {
    await mount();
    await settle(() => button('Adjust bid').click());
    await select('Administrator override member', '17');
    await select('Administrator override open position', 'D101');
    expect(button('Review adjustment').disabled).toBe(true);
    await select('Administrator override A-Day', 'MON');
    expect(button('Review adjustment').disabled).toBe(false);
    expect(previews).toHaveLength(0);
    expect(commands).toHaveLength(0);
    await settle(() => button('Review adjustment').click());
    expect(previews[0]?.reason).toBe('');
    await input('Note (optional)', 'abc');
    expect(button('Review adjustment').disabled).toBe(false);
    await settle(() => button('Review adjustment').click());
    expect(previews[1]?.reason).toBe('abc');
    expect(commands).toHaveLength(0);
  });
  it('confirms an out-of-order award without a typed note after advisory acknowledgement', async () => {
    await mount();
    await settle(() => button('Adjust bid').click());
    await select('Administrator override member', '18');
    await select('Administrator override open position', 'B105');
    await select('Administrator override A-Day', 'G2');
    await reviewAndAcknowledge();
    await settle(() => button('Confirm administrator selection').click());
    expect(previews[0]).toMatchObject({ memberId: 18, positionId: 'B105', reason: '' });
    expect(commands[0]).toMatchObject({
      memberId: 18,
      positionId: 'B105',
      reason: '',
      adminOverride: { acknowledged: true, warningCodes: warnings.map((warning) => warning.code) },
    });
  });
  it('skips an arbitrary waiting member only after review and preserves the deferred-rights explanation', async () => {
    await mount();
    await settle(() => button('Adjust bid').click());
    await select('Administrator override action', 'SKIP');
    await select('Administrator override member', '19');
    await input('Note (optional)', 'Member asked to return later');
    expect(container.textContent).toContain('retains their selection rights');
    await reviewAndAcknowledge();
    expect(commands).toHaveLength(0);
    await settle(() => button('Confirm skip for now').click());
    expect(commands[0]).toMatchObject({
      type: 'live.disposition',
      memberId: 19,
      disposition: 'SKIP',
      adminOverride: { acknowledged: true },
    });
    expect(commands[0]).not.toHaveProperty('positionId');
  });
  it('bypasses the current Days Captain step without fabricating any award', async () => {
    await mount();
    await settle(() => button('Adjust bid').click());
    await select('Administrator override action', 'DEFER_STAGE');
    await input('Note (optional)', 'Days Captains will select later');
    await reviewAndAcknowledge();
    expect(container.textContent).toContain('3 turns remain pending');
    expect(commands).toHaveLength(0);
    await settle(() => button('Confirm bypass current step').click());
    expect(commands[0]).toMatchObject({
      type: 'live.disposition',
      disposition: 'DEFER',
      deferStageId: 'days-captains',
      memberId: 17,
    });
    expect(commands[0]).not.toHaveProperty('positionId');
  });
  it('invalidates acknowledgement after identity or reason changes', async () => {
    await mount();
    await draftAward();
    await reviewAndAcknowledge();
    await select('Administrator override member', '19');
    expect(container.textContent).not.toContain('Confirm administrator selection');
    expect(commands).toHaveLength(0);
    await select('Administrator override open position', 'C103');
    await select('Administrator override A-Day', 'G3');
    await reviewAndAcknowledge();
    await input('Note (optional)', 'Updated administrator direction');
    expect(container.textContent).not.toContain('Confirm administrator selection');
    expect(commands).toHaveLength(0);
  });
  it('invalidates a preview when canonical sequence changes without auto-picking', async () => {
    await mount();
    await draftAward();
    await reviewAndAcknowledge();
    props = { ...props, sequence: 5 };
    await settle(() => root?.render(<AdministratorOverride {...props} />));
    expect(container.textContent).toContain('Review the override again before confirming.');
    expect(container.textContent).not.toContain('Confirm administrator selection');
    expect(commands).toHaveLength(0);
  });
  it('rejects a preview for the wrong member identity', async () => {
    previewIdentityWrong = true;
    await mount();
    await draftAward();
    await settle(() => button('Review adjustment').click());
    expect(container.textContent).toContain('preview does not match your action');
    expect(container.textContent).not.toContain('Confirm administrator selection');
    expect(commands).toHaveLength(0);
  });
  it('retains the reviewed draft across unchanged operator recovery without auto-submitting', async () => {
    await mount();
    await draftAward();
    await reviewAndAcknowledge();
    props = { ...props, commandsBlocked: true };
    await settle(() => root?.render(<AdministratorOverride {...props} />));
    expect(button('Confirm administrator selection').disabled).toBe(true);
    props = { ...props, commandsBlocked: false };
    await settle(() => root?.render(<AdministratorOverride {...props} />));
    expect(button('Confirm administrator selection').disabled).toBe(false);
    expect(commands).toHaveLength(0);
  });
  it('reuses the exact command ID after a lost mutation response', async () => {
    await mount();
    await draftAward();
    await reviewAndAcknowledge();
    failCommandOnce = true;
    await settle(() => button('Confirm administrator selection').click());
    await settle(() => button('Confirm administrator selection').click());
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(canonicalChange).toHaveBeenCalledOnce();
  });
  it('uses authoritative frozen lists and hides filled or reserved positions', async () => {
    props = { ...props, fills: { A101: { member_id: 17 } } };
    await mount();
    await settle(() => button('Adjust bid').click());
    const memberSelect = container.querySelector(
      'select[aria-label="Administrator override member"]',
    ) as unknown as HTMLSelectElement;
    expect([...memberSelect.options].map((option) => option.value)).toEqual(['', '17', '18', '19']);
    const positionSelect = container.querySelector(
      'select[aria-label="Administrator override open position"]',
    ) as unknown as HTMLSelectElement;
    expect([...positionSelect.options].map((option) => option.value)).toEqual([
      '',
      'D101',
      'B105',
      'C103',
    ]);
    await select('Administrator override member', '17');
    expect(container.textContent).toContain('holds A101');
    expect(button('Review adjustment').disabled).toBe(true);
  });
  it.each(['C103', 'B105'])(
    'awards a firefighter %s with an optional empty note and deferred A-Day',
    async (positionId) => {
      await mount();
      await settle(() => button('Adjust bid').click());
      await select('Administrator override member', '19');
      await select('Administrator override open position', positionId);
      expect(button('Review adjustment').disabled).toBe(true);
      await settle(() =>
        (
          container.querySelector('input[aria-label="Pick A-Day later"]') as HTMLInputElement
        ).click(),
      );
      await reviewAndAcknowledge();
      expect(previews[0]).not.toHaveProperty('aDay');
      expect(commands).toHaveLength(0);
      await settle(() => button('Confirm administrator selection').click());
      expect(commands[0]).toMatchObject({
        type: 'live.record_selection',
        memberId: 19,
        positionId,
        reason: '',
        adminOverride: { acknowledged: true },
      });
      expect(commands[0]).not.toHaveProperty('aDay');
      expect(members['19']?.rank).toBe('FF');
    },
  );
  it('sets or changes an awarded member A-Day without moving or duplicating the seat', async () => {
    props = { ...props, fills: { A101: { member_id: 18, a_day: 'G1' } }, combatGroups: ['G1'] };
    await mount();
    await settle(() => button('Adjust bid').click());
    await select('Administrator override action', 'A_DAY');
    await select('Administrator override member', '18');
    const options = container.querySelector(
      'select[aria-label="Administrator override A-Day"]',
    ) as unknown as HTMLSelectElement | null;
    if (!options) throw new Error('A-Day choices missing');
    expect([...options.options].map((entry) => entry.value)).toEqual(['', 'G1', 'G2', 'G3', 'G4']);
    await select('Administrator override A-Day', 'G4');
    await input('Note (optional)', 'Chief approved group change');
    // The server resolves the exact recorded position; the client never sends a replacement award.
    await reviewAndAcknowledge();
    expect(commands).toHaveLength(0);
    await settle(() => button('Confirm A-Day adjustment').click());
    expect(commands[0]).toMatchObject({ type: 'live.record_a_day', memberId: 18, aDay: 'G4' });
    expect(commands[0]).not.toHaveProperty('positionId');
  });
  it('permits an awarded member custom temporary duty after a retained-seat advisory, without removing the seat', async () => {
    props = { ...props, fills: { A101: { member_id: 17 } }, nonBiddablePositions: [] };
    await mount();
    await settle(() => button('Adjust bid').click());
    await select('Administrator override action', 'DUTY');
    await input('Adjustment duty label', 'Acting Division Chief of Prevention');
    await input('Note (optional)', 'Chief directed temporary duty');
    expect(container.textContent).toContain('Existing seat A101 stays assigned');
    await reviewAndAcknowledge();
    expect(commands).toHaveLength(0);
    await settle(() => button('Confirm temporary duty').click());
    expect(commands[0]).toMatchObject({
      type: 'live.set_exceptional_assignment',
      operation: 'ASSIGN',
      memberId: 17,
      roleLabel: 'Acting Division Chief of Prevention',
    });
    expect(commands[0]).not.toHaveProperty('positionId');
    expect(commands[0]).not.toHaveProperty('aDay');
  });
});
