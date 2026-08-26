'use client';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { StationGroupedGrid } from '../../_components/bid/StationGroupedGrid';
import type { MemberLite } from '../../_components/bid/types';
import { BidStoreProvider } from '../_hooks/BidStoreContext';
import { type BidStoreState, createBidStore } from '../_hooks/useBidStore';
import { useBidWebSocket } from '../_hooks/useBidWebSocket';
import { ErrorToast } from './ErrorToast';
import { ReconnectingOverlay } from './ReconnectingOverlay';
import { YourTurnPanel } from './YourTurnPanel';

interface Props {
  bidSessionId: string;
  initialSeq: number;
  meMemberId: number;
  jwt: string;
  initialFills: Record<string, { memberId: number; ordinal: number; bidId: string }>;
  /** Bidder the SSR snapshot believed was up — seeds the Zustand store so
   *  the UI shows the right name before WS connects and survives a stale
   *  state_snapshot that ships currentBidderId=null. */
  initialCurrentBidderId?: number | null;
  eligiblePositionIds: string[];
  members: Record<string, MemberLite>;
  /** Worker origin (https://api.staging.bid.mbfdhub.com) for the WebSocket
   *  upgrade. The Pages domain doesn't proxy WS; we must dial the Worker
   *  directly. Pass empty/undefined to fall back to same-origin (tests). */
  wsBase?: string;
}

export function BidBoard({
  bidSessionId,
  initialSeq,
  meMemberId,
  jwt,
  initialFills,
  initialCurrentBidderId,
  eligiblePositionIds,
  members,
  wsBase,
}: Props) {
  const store = useMemo(() => {
    const s = createBidStore({ bidSessionId, initialSeq, meMemberId });
    s.setState({ fills: initialFills, currentBidderId: initialCurrentBidderId ?? null });
    return s;
  }, [bidSessionId, initialSeq, meMemberId, initialFills, initialCurrentBidderId]);
  const { status, send } = useBidWebSocket(store, { bidSessionId, jwt, wsBase });
  const lastError = useStore(store, (s: BidStoreState) => s.lastError);
  return (
    <BidStoreProvider store={store}>
      <StationGroupedGrid members={members} />
      <YourTurnPanel
        store={store}
        send={send}
        connectionStatus={status}
        eligiblePositionIds={eligiblePositionIds}
      />
      {status !== 'open' ? <ReconnectingOverlay status={status} /> : null}
      {lastError ? (
        <ErrorToast error={lastError} onClose={() => store.getState().clearError()} />
      ) : null}
    </BidStoreProvider>
  );
}
