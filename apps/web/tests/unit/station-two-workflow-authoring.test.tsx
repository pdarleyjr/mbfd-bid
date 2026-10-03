// @vitest-environment jsdom
import type { BidDefinitionContent } from '@mbfd/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { stationTwoSourceDefinition } from '../../../worker/tests/unit/helpers/station-two-definition';
import { BidPolicyFields } from '../../app/admin/current-bid/BidPolicyFields';

vi.mock('@/lib/use-credential-catalog', () => ({ useCredentialCatalog: () => ({ data: [] }) }));
vi.mock('../../app/admin/current-bid/BidFields', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useBidMembers: () => ({ data: [] }),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

it('prepares a typed source-backed draft only on explicit action without saving or starting a session', async () => {
  const original = stationTwoSourceDefinition();
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const edited: BidDefinitionContent[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <BidPolicyFields
          content={original}
          section="specialties"
          onChange={(content) => edited.push(content)}
        />,
      ),
    );
    expect(edited).toHaveLength(0);
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Prepare Station 2 priority workflow',
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
    expect(edited).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled();
    const content = edited[0];
    expect(content?.rules).toEqual(original.rules);
    expect(
      content?.policy?.executionPolicy.annualOperations?.specialties
        ?.slice(1)
        .map((entry) => entry.id),
    ).toEqual(['2026-station-two-cpt', '2026-station-two-lt', '2026-station-two-ff']);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    container.remove();
  }
});
