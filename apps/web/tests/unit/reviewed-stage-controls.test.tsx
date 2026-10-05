// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PositionMeta } from '../../app/_components/bid/types';
import {
  ReviewedStageControls,
  type StageControlsMetadata,
} from '../../app/admin/bid/_components/ReviewedStageControls';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root;
let host: HTMLDivElement;
let originalWindowFetch: typeof fetch;
let bodies: Array<{ preview: boolean; body: Record<string, unknown> }>;
let saved: ReturnType<typeof vi.fn<() => void>>;

const metadata = (): StageControlsMetadata => ({
  allowed: true,
  current_stage_id: 'field-members',
  stages: [
    { id: 'earlier-a', label: 'Earlier officers', completed: false },
    { id: 'earlier-b', label: 'Next officers', completed: false },
    { id: 'field-members', label: 'Field members', completed: false },
  ],
  withdrawable_position_ids: ['A901', 'B901', 'C901', 'A111'],
  withdrawn_position_ids: ['B902'],
});
const positions: PositionMeta[] = ['A901', 'B901', 'C901', 'A111', 'B902', 'A801'].map((id) => ({
  id,
  shift: id.startsWith('A') ? 'A' : id.startsWith('B') ? 'B' : 'C',
  station: '1',
  unit: id.endsWith('901') ? 'Float' : 'Engine',
  rankRequired: 'CPT',
  positionName: id === 'A801' ? 'Reserved Captain' : 'Synthetic position',
}));

async function mount(data = metadata(), sequence = 7, disabled = false) {
  await act(() =>
    root.render(
      <ReviewedStageControls
        sessionId="synthetic-stages"
        sequence={sequence}
        metadata={data}
        positions={positions}
        reason=""
        disabled={disabled}
        onSaved={saved}
      />,
    ),
  );
}
async function click(label: string, twice = false) {
  const node = [
    ...host.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input'),
  ].find((item) => item.getAttribute('aria-label') === label || item.textContent === label);
  if (!node) throw new Error(`Missing control ${label}`);
  await act(async () => {
    node.click();
    if (twice) node.click();
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  originalWindowFetch = window.fetch;
  bodies = [];
  saved = vi.fn<() => void>();
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/auth/csrf')
      return Response.json({ token: 'csrf_00000000-0000-0000-0000-000000000001' });
    const preview = String(input).endsWith('/preview');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push({ preview, body });
    return preview
      ? Response.json({
          valid: true,
          expectedSeq: body.expectedSeq,
          scoreReceiptSha256: 'a'.repeat(64),
          warnings: [
            { code: 'STAGE_COMPLETION', message: 'Finish the earlier stages.' },
            {
              code:
                body.restoreOpenPositionIds && (body.restoreOpenPositionIds as string[]).length
                  ? 'OPPORTUNITY_RESTORATION'
                  : 'OPPORTUNITY_WITHDRAWAL',
              message: 'Review the exact open-position change.',
            },
          ],
        })
      : Response.json({ kind: 'accepted', seq: Number(body.expectedSeq) + 1 });
  });
  vi.stubGlobal('fetch', fetcher);
  window.fetch = fetcher;
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  window.fetch = originalWindowFetch;
});

describe('reviewed stage and open-position controls', () => {
  it('reviews same-stage completion and three exact server-authorized openings with an empty optional note before one confirmation', async () => {
    await mount();
    const review = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Review stage adjustment',
    );
    expect(review?.disabled).toBe(true);
    expect(host.querySelector('input[aria-label="Withdraw A801"]')).toBeNull();
    await click('Complete earlier stages');
    for (const id of ['C901', 'A901', 'B901']) await click(`Withdraw ${id}`);
    await click('Review stage adjustment');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.body).toMatchObject({
      type: 'live.transition_stage',
      stageId: 'field-members',
      completePriorStages: true,
      withdrawOpenPositionIds: ['A901', 'B901', 'C901'],
      expectedSeq: 7,
      reason: '',
      adminOverride: { acknowledged: true, warningCodes: [] },
    });
    expect(bodies[0]?.body).not.toHaveProperty('restoreOpenPositionIds');
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Confirm stage adjustment',
    );
    expect(confirm?.disabled).toBe(true);
    expect(host.textContent).toContain('Finish the earlier stages.');
    await click('I reviewed stage adjustment');
    await click('Confirm stage adjustment', true);
    const accepted = bodies.filter((entry) => !entry.preview);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.body).toMatchObject({
      expectedScoreReceiptSha256: 'a'.repeat(64),
      adminOverride: {
        acknowledged: true,
        warningCodes: ['STAGE_COMPLETION', 'OPPORTUNITY_WITHDRAWAL'],
      },
    });
    expect(accepted[0]?.body).not.toHaveProperty('memberId');
    expect(accepted[0]?.body).not.toHaveProperty('aDay');
    expect(saved).toHaveBeenCalledOnce();
    for (const id of ['A901', 'B901', 'C901'])
      expect(
        host.querySelector<HTMLInputElement>(`input[aria-label="Withdraw ${id}"]`)?.checked,
      ).toBe(false);
    const fresh = metadata();
    fresh.withdrawable_position_ids = ['A111'];
    await mount(fresh, 8);
    expect(host.textContent).not.toContain('A selected opening changed.');
  });

  it('restores a withdrawn position through the same reviewed flow without requiring stage completion', async () => {
    const data = metadata();
    data.stages = data.stages.map((stage, index) => ({ ...stage, completed: index < 2 }));
    await mount(data);
    await click('Restore B902');
    await click('Review stage adjustment');
    expect(bodies[0]?.body).toMatchObject({
      stageId: 'field-members',
      completePriorStages: false,
      restoreOpenPositionIds: ['B902'],
      reason: '',
    });
    expect(bodies[0]?.body).not.toHaveProperty('withdrawOpenPositionIds');
    await click('I reviewed stage adjustment');
    await click('Confirm stage adjustment');
    expect(bodies[1]?.body).toMatchObject({ restoreOpenPositionIds: ['B902'] });
  });

  it('omits both position arrays for completion-only adjustments and does not offer earlier or completed stage targets', async () => {
    await mount();
    const earlier = host.querySelector<HTMLOptionElement>('option[value="earlier-a"]');
    expect(earlier?.disabled).toBe(true);
    expect(host.querySelector<HTMLOptionElement>('option[value="field-members"]')?.disabled).toBe(
      false,
    );
    await click('Complete earlier stages');
    await click('Review stage adjustment');
    expect(bodies[0]?.body.completePriorStages).toBe(true);
    expect(bodies[0]?.body).not.toHaveProperty('withdrawOpenPositionIds');
    expect(bodies[0]?.body).not.toHaveProperty('restoreOpenPositionIds');
  });

  it('invalidates review and preserves changed opening choices until the operator clears them', async () => {
    await mount();
    await click('Withdraw A901');
    await click('Review stage adjustment');
    const changed = metadata();
    changed.withdrawable_position_ids = ['B901', 'C901'];
    await mount(changed, 8);
    expect(host.textContent).toContain('A selected opening changed.');
    expect(host.textContent).toContain('1 to withdraw');
    expect(
      [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Confirm stage adjustment',
      ),
    ).toBeUndefined();
    await click('Review stage adjustment');
    expect(bodies).toHaveLength(1);
    await click('Clear positions');
    expect(host.textContent).not.toContain('A selected opening changed.');
  });

  it('blocks controls during unavailable/auth state and hides them without canonical authority', async () => {
    await mount(metadata(), 7, true);
    await click('Complete earlier stages');
    await click('Withdraw A901');
    await click('Review stage adjustment');
    expect(bodies).toHaveLength(0);
    await mount({ ...metadata(), allowed: false });
    expect(host.textContent).toBe('');
  });

  it('requests a new stage choice when an external transition overtakes the draft', async () => {
    await mount();
    await click('Withdraw A901');
    const changed = metadata();
    changed.stages.push({ id: 'later-field', label: 'Later field stage', completed: false });
    changed.current_stage_id = 'later-field';
    await mount(changed, 8);
    expect(host.textContent).toContain(
      'The bid stage changed. Choose the current stage or a later stage.',
    );
    expect(host.textContent).not.toContain('A selected opening changed.');
    await click('Review stage adjustment');
    expect(bodies).toHaveLength(0);
  });
});
