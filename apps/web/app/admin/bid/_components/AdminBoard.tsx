'use client';
import type { BidAdvisoryBundle } from '@mbfd/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { StationGroupedGrid } from '../../../_components/bid/StationGroupedGrid';
import type { MemberLite, PositionMeta } from '../../../_components/bid/types';
import { ErrorToast } from '../../../bid/_components/ErrorToast';
import { ReconnectingOverlay } from '../../../bid/_components/ReconnectingOverlay';
import { BidStoreProvider } from '../../../bid/_hooks/BidStoreContext';
import { type BidStoreState, createBidStore } from '../../../bid/_hooks/useBidStore';
import { useBidWebSocket } from '../../../bid/_hooks/useBidWebSocket';
import { BidAdvisoryPanel } from './BidAdvisoryPanel';
import { useManualPick } from './ManualPickContext';

interface Props {
  bidSessionId: string;
  initialSeq: number;
  meMemberId: number;
  initialFills: Record<string, { memberId: number; ordinal: number; bidId: string }>;
  /** Bidder the SSR snapshot believed was up — fed into the store so the
   *  client UI shows the right member before the WS connects (or if the WS
   *  state_snapshot ships currentBidderId=null because the DO is stale). */
  initialCurrentBidderId: number | null;
  members: Record<string, MemberLite>;
  /** Immutable material returned by /api/board for this exact session. */
  positions?: readonly PositionMeta[] | undefined;
  /** See BidBoard — Worker origin for the WebSocket upgrade (Pages domain
   *  doesn't proxy WS). */
  wsBase?: string;
  /** Server-composed explanation of the same authoritative board snapshot. */
  advisory: BidAdvisoryBundle;
}

export function AdminBoard({
  bidSessionId,
  initialSeq,
  meMemberId,
  initialFills,
  initialCurrentBidderId,
  members,
  positions,
  wsBase,
  advisory,
}: Props) {
  const router = useRouter();
  const store = useMemo(() => {
    const s = createBidStore({ bidSessionId, initialSeq, meMemberId });
    s.setState({ fills: initialFills, currentBidderId: initialCurrentBidderId });
    return s;
  }, [bidSessionId, initialSeq, meMemberId, initialFills, initialCurrentBidderId]);
  const { status } = useBidWebSocket(store, { bidSessionId, wsBase });
  const lastError = useStore(store, (s: BidStoreState) => s.lastError);
  const observedSequence = useStore(store, (s: BidStoreState) => s.lastSeq);
  const refreshedSequence = useRef(initialSeq);
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

  useEffect(() => {
    refreshedSequence.current = Math.max(refreshedSequence.current, initialSeq);
  }, [initialSeq]);

  useEffect(() => {
    if (observedSequence <= refreshedSequence.current) return;
    refreshedSequence.current = observedSequence;
    // The socket supplies the immediate event projection. Refresh the server
    // component once so its advisory is recomposed from the authoritative
    // board read model at that exact sequence.
    router.refresh();
  }, [observedSequence, router]);

  return (
    <BidStoreProvider store={store}>
      <BidAdvisoryPanel advisory={advisory} />
      <StationGroupedGrid
        members={members}
        positions={positions}
        snapshotBound
        onPositionClick={positionClickHandler}
      />
      {status !== 'open' ? <ReconnectingOverlay status={status} /> : null}
      {lastError ? (
        <ErrorToast error={lastError} onClose={() => store.getState().clearError()} />
      ) : null}
    </BidStoreProvider>
  );
}
