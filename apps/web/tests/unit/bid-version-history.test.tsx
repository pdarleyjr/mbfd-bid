import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BidVersionHistory } from '../../app/admin/current-bid/BidVersionHistory';
// @vitest-environment jsdom
import type { BidVersion, CurrentBid, HistoricalBid } from '../../app/admin/current-bid/bid-client';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

let root: Root | undefined;
let container: HTMLDivElement;

const version: BidVersion = {
  id: 'synthetic-historical-version',
  versionNumber: 4,
  contentSha256: '4'.repeat(64),
  createdAtMs: 1_800_000_000_000,
  actorSubject: 'synthetic-admin',
  reason: 'Synthetic saved selector authoring',
  predecessorId: 'synthetic-historical-version-3',
  restoredFromId: null,
};

const historical = {
  bidYear: 2027,
  version,
  content: {
    policy: {
      executionPolicy: {
        stages: [{ id: 'stage-firefighter', label: 'Firefighter stage' }],
      },
      stageParticipantSources: [
        {
          stageId: 'stage-firefighter',
          sourceRef: 'Synthetic approved policy source',
          participantSource: { type: 'FILTER', active: true, ranks: ['FF', 'LT'] },
          ordering: [
            { key: 'RSC_SENIORITY', direction: 'ASC' },
            { key: 'RANK_SENIORITY', direction: 'DESC' },
          ],
        },
      ],
    },
    positions: [],
  },
  stats: { opportunityCount: 0, ruleCount: 0 },
} as unknown as HistoricalBid;

const base = { version: null } as CurrentBid;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <BidVersionHistory
        base={base}
        versions={[version]}
        versionsLoaded
        nextVersion={null}
        historical={historical}
        busy={false}
        locked={false}
        dirty={false}
        stale={false}
        browseVersions={vi.fn(async () => undefined)}
        selectVersion={vi.fn(async () => undefined)}
        execute={vi.fn(async () => undefined)}
      />,
    );
  });
}

describe('Bid version history', () => {
  it('labels saved participant selector data as authoring rather than a resolved roster', async () => {
    await render();

    expect(container.textContent).toContain('Saved participant selector authoring (1)');
    expect(container.textContent).toContain(
      'Saved selector authoring only. This is not a resolved roster.',
    );
    expect(container.textContent).toContain('Firefighter stage (stage-firefighter)');
    expect(container.textContent).toContain('Synthetic approved policy source');
    expect(container.textContent).toContain('FILTER · Active BIDDABLE ranks: FF, LT.');
    expect(container.textContent).toContain('Ordering: RSC_SENIORITY ASC → RANK_SENIORITY DESC.');
    expect(container.textContent).not.toContain('Resolved roster:');
  });
});
