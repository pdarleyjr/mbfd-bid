// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewAnnualBidFromStructure } from '../../app/admin/current-bid/NewAnnualBidFromStructure';

const annualPost = vi.hoisted(() => vi.fn());
vi.mock('../../app/admin/annual-plan/annual-plan-client', () => ({ annualPost }));
vi.mock('@/components/admin/TaskPanel', () => ({
  TaskPanel: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('NewAnnualBidFromStructure', () => {
  let root: Root;
  let container: HTMLDivElement;
  const onCreated = vi.fn();

  beforeEach(async () => {
    annualPost.mockResolvedValue({
      targetYear: 2027,
      notice: 'Synthetic annual draft created.',
      reviewItems: ['participants', 'operator authority'],
    });
    onCreated.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <NewAnnualBidFromStructure
          sourceYear={2026}
          sourceVersion={{
            id: 'synthetic-saved-version',
            versionNumber: 4,
            contentSha256: 'a'.repeat(64),
            createdAtMs: 1,
            actorSubject: 'synthetic',
            reason: 'Synthetic saved source',
            predecessorId: null,
            restoredFromId: null,
          }}
          content={null}
          disabled={false}
          onCreated={onCreated}
        />,
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('uses only the immutable saved version and explicit new annual inputs', async () => {
    const launch = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'New Annual Bid',
    );
    if (!launch) throw new Error('New Annual Bid control required');
    await act(async () => launch.click());
    const inputs = [...container.querySelectorAll<HTMLInputElement>('input')];
    expect(inputs).toHaveLength(7);
    const [
      targetYearInput,
      effectiveOnInput,
      credentialEvaluationInput,
      durationInput,
      timerInput,
      reasonInput,
      acceptanceInput,
    ] = inputs;
    if (
      !targetYearInput ||
      !effectiveOnInput ||
      !credentialEvaluationInput ||
      !durationInput ||
      !timerInput ||
      !reasonInput ||
      !acceptanceInput
    )
      throw new Error('carry-forward fields required');
    await act(async () => {
      setInput(targetYearInput, '2027');
      setInput(effectiveOnInput, '2027-10-05');
      setInput(credentialEvaluationInput, '2027-10-05');
      setInput(durationInput, '3');
      setInput(timerInput, '180');
      setInput(reasonInput, 'Synthetic annual carry-forward authorization.');
      acceptanceInput.click();
    });
    const form = container.querySelector('form');
    if (!form) throw new Error('carry-forward form required');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(annualPost).toHaveBeenCalledWith(
      'annual-plan/from-bid-definition',
      expect.objectContaining({
        source_year: 2026,
        source_version_id: 'synthetic-saved-version',
        source_version_sha256: 'a'.repeat(64),
        target_year: 2027,
        effective_on: '2027-10-05',
        credential_evaluation_on: '2027-10-05',
        accept_carry_forward: true,
      }),
      expect.any(String),
    );
    expect(onCreated).toHaveBeenCalledWith(2027);
  });
});
