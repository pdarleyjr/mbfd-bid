// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectBid } from '../../app/admin/bid/_components/CorrectBid';
import { OPERATOR_AUTH_REFRESHED, OPERATOR_REAUTH_STARTED } from '../../lib/operator-step-up';

vi.mock('@/components/admin/TaskPanel', () => ({
  TaskPanel: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <section>{children}</section> : null,
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let failConfirm: boolean;
let failReload: boolean;
let staleReload: boolean;
let loadedReadback: typeof readback;
let delayPreview: boolean;
let finishPreview: ((response: Response) => void) | null;
let delayAcceptedReadback: boolean;
let finishAcceptedReadback: ((response: Response) => void) | null;
let canonicalSequence: number | undefined;
let commandsBlocked: boolean;
let overrideAllowed: boolean;
let overridePositionIds: string[];
const commands: Record<string, unknown>[] = [];
const source = {
  bidId: 'award-1',
  originalCommandId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  originalADayCommandId: null,
  originalPositionId: 'one',
  memberId: 17,
  status: 'ACTIVE',
  aDay: 'G1',
  membershipIds: [],
  eligiblePositionIds: ['one', 'two'],
  termParticipation: null as { assignmentId: string } | null,
};
const readback = {
  sequence: 4,
  sealed: false,
  sources: [source],
  positions: [
    { id: 'one', label: 'A 1 Engine Firefighter', shift: 'A' },
    { id: 'two', label: 'A 2 Rescue Firefighter', shift: 'A' },
  ],
  combatGroups: ['G1', 'G2', 'G3', 'G4'],
  opportunityPools: [],
};
const preview = {
  valid: true,
  expectedSeq: 4,
  before: { positionId: 'one', fill: { memberId: 17, aDay: 'G1' }, aDay: null },
  after: { positionId: 'one', fill: { memberId: 17, aDay: 'G2' } },
  reason: 'Recorded wrong A-Day',
  memberId: 17,
  constraintEffects: [
    { group: 'A:G1', before: 1, after: 0 },
    { group: 'A:G2', before: 0, after: 1 },
  ],
  validated: ['Eligibility', 'A-Day limits'],
};

async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(text),
  );
  if (!button) throw new Error(`Button missing: ${text}`);
  await act(async () => {
    button.click();
  });
}
async function change(id: string, value: string) {
  const input = container.querySelector(`#${id}`) as
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement
    | null;
  if (!input) throw new Error(`Input missing: ${id}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      input instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

function value(id: string): string {
  const control = container.querySelector(`#${id}`);
  if (!(control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement))
    throw new Error(`Draft control missing: ${id}`);
  return control.value;
}

async function render() {
  await act(async () =>
    root.render(
      <CorrectBid
        bidSessionId="synthetic-correction"
        canonicalSequence={canonicalSequence}
        commandsBlocked={commandsBlocked}
        overrideAllowed={overrideAllowed}
        overridePositionIds={overridePositionIds}
        members={{
          '17': {
            id: 17,
            rank: 'FF',
            firstName: 'Synthetic',
            lastName: 'Member',
            employeeId: 'synthetic-17',
          },
        }}
      />,
    ),
  );
}

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  failConfirm = false;
  failReload = false;
  staleReload = false;
  loadedReadback = structuredClone(readback);
  delayPreview = false;
  finishPreview = null;
  delayAcceptedReadback = false;
  finishAcceptedReadback = null;
  canonicalSequence = 4;
  commandsBlocked = false;
  overrideAllowed = false;
  overridePositionIds = [];
  commands.length = 0;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/auth/csrf')
      return Response.json({ token: 'csrf_00000000-0000-0000-0000-000000000001' });
    if (url.endsWith('/commands/live/preview')) {
      const command = JSON.parse(String(init?.body)) as {
        expectedSeq: number;
        memberId: number;
        replacement: { positionId: string; aDay: string } | null;
      };
      return Response.json({
        valid: true,
        expectedSeq: command.expectedSeq,
        memberId: command.memberId,
        before: preview.before,
        after: command.replacement
          ? {
              positionId: command.replacement.positionId,
              fill: { memberId: command.memberId, aDay: command.replacement.aDay },
            }
          : null,
        warnings: [
          {
            code: 'ADMIN_OVERRIDE_STAGE',
            message: 'Replacement is outside this member’s reached stages.',
          },
        ],
      });
    }
    if (url.endsWith('/corrections/preview')) {
      if (delayPreview)
        return new Promise<Response>((resolve) => {
          finishPreview = resolve;
        });
      const command = JSON.parse(String(init?.body)) as { expectedSeq: number; reason: string };
      return Response.json({
        ...preview,
        expectedSeq: command.expectedSeq,
        reason: command.reason,
      });
    }
    if (url.endsWith('/commands/live')) {
      commands.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (failConfirm) {
        failConfirm = false;
        throw new Error('Synthetic network loss');
      }
      const acceptedSeq = Number(commands.at(-1)?.expectedSeq) + 1;
      if (!staleReload) loadedReadback.sequence = acceptedSeq;
      return Response.json({ kind: 'accepted', seq: acceptedSeq });
    }
    if (failReload && commands.length > 0) {
      failReload = false;
      throw new Error('Synthetic refresh loss');
    }
    if (delayAcceptedReadback && commands.length > 0)
      return new Promise<Response>((resolve) => {
        finishAcceptedReadback = resolve;
      });
    return Response.json(loadedReadback);
  });
  vi.stubGlobal('fetch', fetchMock);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('guided audited correction', () => {
  async function beginDelayedCorrection(note = '') {
    await click('Correct a bid');
    await change('correction-a-day', 'G2');
    if (note) await change('correction-reason', note);
    await click('Review correction');
    delayAcceptedReadback = true;
    await click('Confirm correction');
    expect(commands).toHaveLength(1);
    expect(finishAcceptedReadback).not.toBeNull();
    expect(container.textContent).toContain('Correction recorded. Refreshing awards');
  }
  async function finishReadback(sequence: number) {
    loadedReadback.sequence = sequence;
    delayAcceptedReadback = false;
    await act(async () => finishAcceptedReadback?.(Response.json(loadedReadback)));
    finishAcceptedReadback = null;
  }
  function reviewButton() {
    const button = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Review correction'),
    );
    if (!button) throw new Error('Missing correction review button');
    return button;
  }
  it.each(['', 'Recorded wrong A-Day'])(
    'refreshes an accepted correction automatically when its own sequence update arrives during readback (note %s)',
    async (note) => {
      await beginDelayedCorrection(note);
      canonicalSequence = 5;
      await render();
      await finishReadback(5);
      expect(container.textContent).toContain(
        'Correction recorded. The award and capacity have been updated.',
      );
      expect(container.textContent).not.toContain('Awards could not be refreshed');
      expect(reviewButton().disabled).toBe(false);
      expect(commands[0]).toMatchObject({ expectedSeq: 4, reason: note });
    },
  );
  it('invalidates the pending refresh when a newer external sequence follows its accepted sequence', async () => {
    await beginDelayedCorrection();
    canonicalSequence = 5;
    await render();
    canonicalSequence = 6;
    await render();
    await finishReadback(6);
    expect(container.textContent).toContain('Correction recorded. Awards could not be refreshed.');
    expect(reviewButton().disabled).toBe(true);
    expect(commands).toHaveLength(1);
    await click('Refresh awards');
    expect(reviewButton().disabled).toBe(false);
    expect(commands).toHaveLength(1);
  });
  it.each(['sign-in', 'blocked parent'] as const)(
    'keeps the pending accepted readback locked when %s changes at its acknowledged sequence',
    async (change) => {
      await beginDelayedCorrection();
      canonicalSequence = 5;
      await render();
      if (change === 'sign-in')
        await act(async () => window.dispatchEvent(new Event(OPERATOR_REAUTH_STARTED)));
      else {
        commandsBlocked = true;
        await render();
      }
      await finishReadback(5);
      expect(container.textContent).toContain(
        'Correction recorded. Awards could not be refreshed.',
      );
      expect(reviewButton().disabled).toBe(true);
      expect(commands).toHaveLength(1);
    },
  );
  it('requires acknowledged server advisories before an override correction and handles the generic preview shape', async () => {
    overrideAllowed = true;
    overridePositionIds = ['outside-stage'];
    loadedReadback.positions.push({
      id: 'outside-stage',
      label: 'B 1 Engine Lieutenant',
      shift: 'B',
    });
    await render();
    await click('Correct a bid');
    await act(async () =>
      (
        container.querySelector(
          'input[aria-label="Use administrator override for correction"]',
        ) as HTMLInputElement
      ).click(),
    );
    await change('correction-position', 'outside-stage');
    await change('correction-a-day', 'G2');
    await change('correction-reason', 'Administrator directed correction');
    await click('Review correction');
    expect(container.textContent).toContain('Replacement is outside this member’s reached stages.');
    expect(container.textContent).toContain('Detailed capacity totals were not included');
    const confirm = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Confirm correction'),
    );
    expect(confirm?.disabled).toBe(true);
    expect(commands).toHaveLength(0);
    await act(async () =>
      (
        container.querySelector(
          'input[aria-label="I acknowledge correction override advisories"]',
        ) as HTMLInputElement
      ).click(),
    );
    expect(commands).toHaveLength(0);
    await click('Confirm correction');
    expect(commands[0]).toMatchObject({
      type: 'live.correct_bid',
      memberId: 17,
      originalBidId: 'award-1',
      originalCommandId: source.originalCommandId,
      replacement: { positionId: 'outside-stage', aDay: 'G2' },
      adminOverride: { acknowledged: true, warningCodes: ['ADMIN_OVERRIDE_STAGE'] },
    });
  });
  it('invalidates reviewed correction override when administrator authority is lost', async () => {
    overrideAllowed = true;
    overridePositionIds = ['two'];
    await render();
    await click('Correct a bid');
    await act(async () =>
      (
        container.querySelector(
          'input[aria-label="Use administrator override for correction"]',
        ) as HTMLInputElement
      ).click(),
    );
    await change('correction-a-day', 'G2');
    await change('correction-reason', 'Administrator directed correction');
    await click('Review correction');
    overrideAllowed = false;
    await render();
    expect(container.textContent).not.toContain('Confirm correction');
    expect(container.textContent).toContain('override authority changed');
    expect(commands).toHaveLength(0);
  });
  it('keeps accepted sequence as a readback floor through stale automatic and manual refreshes', async () => {
    await click('Correct a bid');
    await change('correction-a-day', 'G2');
    await change('correction-reason', 'Recorded wrong A-Day');
    await click('Review correction');
    staleReload = true;
    await click('Confirm correction');
    expect(container.textContent).toContain('Correction recorded');
    expect(container.textContent).not.toContain('award and capacity have been updated');
    expect(container.textContent).not.toContain('Delivery is uncertain');
    await click('Refresh awards');
    const reviewButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Review correction'),
    );
    expect(reviewButton?.disabled).toBe(true);
    loadedReadback.sequence = 5;
    await click('Refresh awards');
    expect(reviewButton?.disabled).toBe(false);
    expect(commands).toHaveLength(1);
  });

  it('clears voluntary election evidence when the authoritative assignment identity changes', async () => {
    loadedReadback.sources[0] = {
      ...source,
      termParticipation: { assignmentId: 'synthetic-term-1' },
    };
    await click('Correct a bid');
    await act(async () => {
      const checkbox = container.querySelector('input[type="checkbox"]');
      if (!(checkbox instanceof HTMLInputElement)) throw new Error('Election checkbox missing');
      checkbox.click();
    });
    await change('correction-term-evidence', 'Synthetic member-confirmed evidence');
    loadedReadback.sources[0] = {
      ...source,
      termParticipation: { assignmentId: 'synthetic-term-2' },
    };
    await click('Refresh awards');
    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox instanceof HTMLInputElement && checkbox.checked).toBe(false);
    const evidence = container.querySelector('#correction-term-evidence');
    expect(evidence instanceof HTMLInputElement && evidence.value).toBe('');
    expect(commands).toHaveLength(0);
  });

  it('retains a non-first award and edited draft through sign-in while invalidating the review', async () => {
    loadedReadback.sources.push({
      ...source,
      bidId: 'award-2',
      originalCommandId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    });
    await click('Correct a bid');
    await change('correction-source', 'award-2');
    await change('correction-position', 'two');
    await change('correction-a-day', 'G3');
    await change('correction-reason', 'Correct earlier award after review');
    await click('Review correction');
    await act(async () => window.dispatchEvent(new Event(OPERATOR_REAUTH_STARTED)));
    expect(container.textContent).not.toContain('Confirm correction');
    await act(async () => window.dispatchEvent(new Event(OPERATOR_AUTH_REFRESHED)));
    expect(commands).toHaveLength(0);
    await click('Refresh awards');
    expect(value('correction-source')).toBe('award-2');
    expect(value('correction-position')).toBe('two');
    expect(value('correction-a-day')).toBe('G3');
    expect(value('correction-reason')).toBe('Correct earlier award after review');
    expect(container.textContent).not.toContain('Confirm correction');
    await click('Review correction');
    await click('Confirm correction');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      originalBidId: 'award-2',
      replacement: { positionId: 'two', aDay: 'G3' },
    });
  });

  it('discards a delayed preview when sign-in begins before its response', async () => {
    await click('Correct a bid');
    await change('correction-a-day', 'G2');
    await change('correction-reason', 'Recorded wrong A-Day');
    delayPreview = true;
    await click('Review correction');
    expect(finishPreview).not.toBeNull();
    await act(async () => window.dispatchEvent(new Event(OPERATOR_REAUTH_STARTED)));
    await act(async () => finishPreview?.(Response.json(preview)));
    expect(container.textContent).not.toContain('Confirm correction');
    expect(commands).toHaveLength(0);
    expect(value('correction-a-day')).toBe('G2');
  });

  it('blocks a reviewed command when canonical sequence changes and rejects an older award readback', async () => {
    await click('Correct a bid');
    await change('correction-reason', 'Recorded wrong A-Day');
    await click('Review correction');
    canonicalSequence = 5;
    await render();
    expect(container.textContent).not.toContain('Confirm correction');
    await click('Refresh awards');
    const reviewButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Review correction'),
    );
    expect(reviewButton?.disabled).toBe(true);
    expect(container.textContent).toContain('Awards changed while loading');
    loadedReadback.sequence = 5;
    await click('Refresh awards');
    expect(reviewButton?.disabled).toBe(false);
    await click('Review correction');
    await click('Confirm correction');
    expect(commands).toHaveLength(1);
    expect(commands[0]?.expectedSeq).toBe(5);
  });

  it('discards a delayed preview when the parent blocks commands', async () => {
    await click('Correct a bid');
    await change('correction-reason', 'Recorded wrong A-Day');
    delayPreview = true;
    await click('Review correction');
    commandsBlocked = true;
    await render();
    await act(async () => finishPreview?.(Response.json(preview)));
    expect(container.textContent).not.toContain('Confirm correction');
    expect(commands).toHaveLength(0);
  });

  it('refreshes changed award lineage without retaining an invalid correction review', async () => {
    await click('Correct a bid');
    await change('correction-a-day', 'G3');
    await change('correction-reason', 'Recorded wrong A-Day');
    await click('Review correction');
    loadedReadback.sources[0] = {
      ...source,
      originalCommandId: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
      aDay: 'G2',
    };
    await click('Refresh awards');
    expect(container.textContent).not.toContain('Confirm correction');
    expect(value('correction-a-day')).toBe('G2');
    expect(commands).toHaveLength(0);
  });

  it('loads the original receipt and retains an optional typed note through preview and confirmation', async () => {
    await click('Correct a bid');
    expect(container.textContent).toContain('Synthetic Member');
    expect(container.textContent).not.toContain('Confirm correction');
    await change('correction-a-day', 'G2');
    await change('correction-reason', 'Recorded wrong A-Day');
    await click('Review correction');
    expect(container.textContent).toContain('BEFORE');
    expect(container.textContent).toContain('AFTER');
    expect(container.textContent).toContain('Recorded wrong A-Day');
    expect(container.textContent).toContain('A:G1');
    expect(commands).toHaveLength(0);
    await click('Confirm correction');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: 'live.correct_bid',
      originalCommandId: source.originalCommandId,
      originalBidId: source.bidId,
      expectedSeq: 4,
      reason: 'Recorded wrong A-Day',
      replacement: { positionId: 'one', aDay: 'G2' },
    });
  });

  it('confirms a correction without a typed note after the server preview', async () => {
    await click('Correct a bid');
    await change('correction-a-day', 'G3');
    expect(value('correction-reason')).toBe('');
    await click('Review correction');
    expect(container.textContent).toContain('BEFORE');
    expect(commands).toHaveLength(0);
    await click('Confirm correction');
    expect(commands[0]).toMatchObject({
      type: 'live.correct_bid',
      originalCommandId: source.originalCommandId,
      expectedSeq: 4,
      replacement: { positionId: 'one', aDay: 'G3' },
      reason: '',
    });
  });

  it('retries the exact reviewed command after uncertain delivery', async () => {
    await click('Correct a bid');
    await change('correction-a-day', 'G2');
    await change('correction-reason', 'Recorded wrong A-Day');
    await click('Review correction');
    failConfirm = true;
    await click('Confirm correction');
    expect(container.textContent).toContain('retry');
    await click('Confirm correction');
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual(commands[1]);
  });

  it('requires a new server review after the operator edits the draft or refreshes awards', async () => {
    await click('Correct a bid');
    await change('correction-reason', 'Recorded wrong A-Day');
    await click('Review correction');
    expect(container.textContent).toContain('Confirm correction');
    await change('correction-a-day', 'G3');
    expect(container.textContent).not.toContain('Confirm correction');
    expect(commands).toHaveLength(0);
    await click('Review correction');
    await click('Refresh awards');
    expect(container.textContent).not.toContain('Confirm correction');
    expect(commands).toHaveLength(0);
  });

  it('preserves accepted acknowledgement and blocks another correction until failed readback is refreshed', async () => {
    await click('Correct a bid');
    await change('correction-reason', 'Recorded wrong A-Day');
    await change('correction-a-day', 'G2');
    await click('Review correction');
    failReload = true;
    await click('Confirm correction');
    expect(commands).toHaveLength(1);
    expect(container.textContent).toContain('Correction recorded');
    expect(container.textContent).not.toContain('Delivery is uncertain');
    expect(container.textContent).not.toContain('Confirm correction');
    const reviewButton = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Review correction'),
    );
    expect(reviewButton?.disabled).toBe(true);
    await click('Refresh awards');
    expect(reviewButton?.disabled).toBe(false);
    expect(commands).toHaveLength(1);
  });
});
