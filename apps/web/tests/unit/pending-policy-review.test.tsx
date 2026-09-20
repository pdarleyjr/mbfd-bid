// @vitest-environment jsdom
import {
  BidDefinitionContentSchema,
  BidDispositionSchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { PendingPolicyReview } from '../../app/admin/current-bid/PendingPolicyReview';

vi.mock('../../app/admin/current-bid/BidFields', async (original) => ({
  ...(await original<typeof import('../../app/admin/current-bid/BidFields')>()),
  useBidMembers: () => ({ data: [{ value: '901', label: 'Synthetic Operator' }] }),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});
function definition(complete: boolean, dates: boolean) {
  return BidDefinitionContentSchema.parse({
    v: 1,
    bidYear: 2027,
    settings: dates
      ? {
          v: 2,
          expectedDurationDays: 2,
          turnTimerSeconds: 180,
          credentialEvaluationOn: '2027-01-01',
        }
      : null,
    notes: { bid: null, positions: null },
    policy: null,
    planning: null,
    authoring: null,
    positions: [],
    rules: [],
    participation: [],
    staffingBindings: [],
    sourceDecisions: [],
    pendingPolicy: {
      policyText: 'SYNTHETIC reviewed policy language',
      executionPolicy: {
        v: 1,
        policyRevision: 'synthetic-review',
        stages: [
          {
            id: 'stage',
            label: 'Synthetic stage',
            order: 1,
            memberIds: complete ? [901] : [],
            opportunityPositionIds: ['synthetic-seat'],
            kind: 'FIREFIGHTER',
          },
        ],
        dispositions: BidDispositionSchema.options.map((disposition) => ({
          disposition,
          advances: disposition !== 'HOLD',
          returns: false,
          returnStageId: null,
          retainsLaterSelectionRights: false,
          terminal: disposition === 'DECLINED',
          requiresReason: true,
          requiresEvidence: disposition === 'UNREACHABLE',
          contactPolicyReference: disposition === 'UNREACHABLE' ? 'synthetic-contact' : null,
        })),
        actionPermissions: LiveBidActionSchema.options.map((action) => ({
          action,
          actorMemberIds: complete ? [901] : [],
        })),
        specialtyCatalogReference: null,
        aDayPolicyReference: null,
        transitionPolicyReference: null,
        publicationPolicyReference: null,
      },
    },
  });
}
function mount(complete: boolean, dates: boolean) {
  const content = definition(complete, dates);
  const change = vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<PendingPolicyReview content={content} onChange={change} />));
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === 'Use reviewed procedures in this draft',
  );
  if (!button) throw new Error('Missing promotion control');
  return { content, change, container, button };
}
it.each([
  [false, false],
  [false, true],
  [true, false],
])('retains pending policy when completeness=%s and dates=%s', (complete, dates) => {
  const { change, container, button } = mount(complete, dates);
  expect(container.textContent).toContain('not executable');
  expect(button.disabled).toBe(true);
  act(() => button.click());
  expect(change).not.toHaveBeenCalled();
});
it('requires an explicit draft action after complete review and preserves the source policy', () => {
  const { content, change, button } = mount(true, true);
  expect(button.disabled).toBe(false);
  expect(change).not.toHaveBeenCalled();
  act(() => button.click());
  expect(change).toHaveBeenCalledOnce();
  const result = BidDefinitionContentSchema.parse(change.mock.calls[0]?.[0]);
  expect(result.pendingPolicy).toBeUndefined();
  expect(result.policy).toEqual(content.pendingPolicy);
  expect(result.settings).toMatchObject({
    v: 3,
    livePolicy: content.pendingPolicy?.executionPolicy,
  });
  expect(content.policy).toBeNull();
});
