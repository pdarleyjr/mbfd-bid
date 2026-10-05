// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { AnnualLiveControls } from '../../app/admin/bid/_components/AnnualLiveControls';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

describe('canonical pending A-Day rights in the operator workspace', () => {
  it.each([{ pendingIds: [] }, { pendingIds: [3] }, { pendingIds: [1] }])(
    'uses the explicit pending IDs $pendingIds without inferring an obligation from missing saved A-Days or rank',
    async ({ pendingIds }) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      const originalWindowFetch = window.fetch;
      const callback =
        vi.fn<
          (state: {
            aDayPendingMemberIds: number[];
            aDayDueMemberIds: number[];
            temporarilyAssignedMemberIds: number[];
          }) => void
        >();
      const fills = { A101: { member_id: 1 }, A102: { member_id: 2 }, A103: { member_id: 3 } };
      const fetcher = vi.fn(async () =>
        Response.json({
          sequence: 4,
          current_phase: 'position_bid',
          a_day_selection: 'SIMULTANEOUS',
          a_day_pending_member_ids: pendingIds,
          current_bidder: {
            member_id: 3,
            first_name: 'Synthetic',
            last_name: 'Member',
            rank: 'FF',
          },
          remaining_order: [3],
          fills,
          specialties: [],
          active: null,
          a_day_current: null,
        }),
      );
      vi.stubGlobal('fetch', fetcher);
      window.fetch = fetcher;
      try {
        await act(async () =>
          root.render(
            <AnnualLiveControls
              workspace
              bidSessionId="synthetic-ended-rights"
              isMock={false}
              currentBidderId={3}
              bidOrder={[]}
              fills={{}}
              members={{}}
              positions={[]}
              onWorkspaceStateChange={callback}
            />,
          ),
        );
        expect(callback.mock.lastCall?.[0].aDayPendingMemberIds).toEqual(pendingIds);
        expect(callback.mock.lastCall?.[0].aDayDueMemberIds).toEqual([]);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fills).toEqual({
          A101: { member_id: 1 },
          A102: { member_id: 2 },
          A103: { member_id: 3 },
        });
      } finally {
        await act(() => root.unmount());
        host.remove();
        vi.unstubAllGlobals();
        window.fetch = originalWindowFetch;
      }
    },
  );
});
