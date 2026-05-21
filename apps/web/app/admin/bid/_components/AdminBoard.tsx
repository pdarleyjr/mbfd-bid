'use client';
import { useCallback, useMemo } from 'react';
import { useStore } from 'zustand';
import { StationGroupedGrid } from '../../../_components/bid/StationGroupedGrid';
import type { MemberLite } from '../../../_components/bid/types';
import { ErrorToast } from '../../../bid/_components/ErrorToast';
import { ReconnectingOverlay } from '../../../bid/_components/ReconnectingOverlay';
import { BidStoreProvider } from '../../../bid/_hooks/BidStoreContext';
import { type BidStoreState, createBidStore } from '../../../bid/_hooks/useBidStore';
import { useBidWebSocket } from '../../../bid/_hooks/useBidWebSocket';
import { useManualPick } from './ManualPickContext';

interface Props {
  bidSessionId: string;
  initialSeq: number;
  meMemberId: number;
  jwt: string;
  initialFills: Record<string, { memberId: number; ordinal: number; bidId: string }>;
  /** Bidder the SSR snapshot believed was up — fed into the store so the
   *  client UI shows the right member before the WS connects (or if the WS
   *  state_snapshot ships currentBidderId=null because the DO is stale). */
  initialCurrentBidderId: number | null;
  members: Record<string, MemberLite>;
  /** See BidBoard — Worker origin for the WebSocket upgrade (Pages domain
   *  doesn't proxy WS). */
  wsBase?: string;
}

export function AdminBoard({
  bidSessionId,
  initialSeq,
  meMemberId,
  jwt,
  initialFills,
  initialCurrentBidderId,
  members,
  wsBase,
}: Props) {
  const store = useMemo(() => {
    const s = createBidStore({ bidSessionId, initialSeq, meMemberId });
    s.setState({ fills: initialFills, currentBidderId: initialCurrentBidderId });
    return s;
  }, [bidSessionId, initialSeq, meMemberId, initialFills, initialCurrentBidderId]);
  const { status } = useBidWebSocket(store, { bidSessionId, jwt, wsBase });
  const lastError = useStore(store, (s: BidStoreState) => s.lastError);
  const { pickMode, selectedMemberId, submitPick } = useManualPick();

  // Position cells are interactive only when pick mode is on AND the admin
  // has already selected a member. The cell will be open-only (the filled-
  // cell case short-circuits the submit on the server with 409).
  const onPositionClick = useCallback(
    (positionId: string) => {
      if (!pickMode || selectedMemberId === null) return;
      void submitPick({ memberId: selectedMemberId, positionId });
    },
    [pickMode, selectedMemberId, submitPick],
  );
  const positionClickHandler = pickMode && selectedMemberId !== null ? onPositionClick : undefined;

  return (
    <BidStoreProvider store={store}>
      <StationGroupedGrid members={members} onPositionClick={positionClickHandler} />
      {status !== 'open' ? <ReconnectingOverlay status={status} /> : null}
      {lastError ? (
        <ErrorToast error={lastError} onClose={() => store.getState().clearError()} />
      ) : null}
    </BidStoreProvider>
  );
}
