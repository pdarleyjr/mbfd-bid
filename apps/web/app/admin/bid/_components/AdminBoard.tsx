'use client';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { StationGroupedGrid } from '../../../_components/bid/StationGroupedGrid';
import type { MemberLite } from '../../../_components/bid/types';
import { ErrorToast } from '../../../bid/_components/ErrorToast';
import { ReconnectingOverlay } from '../../../bid/_components/ReconnectingOverlay';
import { BidStoreProvider } from '../../../bid/_hooks/BidStoreContext';
import { type BidStoreState, createBidStore } from '../../../bid/_hooks/useBidStore';
import { useBidWebSocket } from '../../../bid/_hooks/useBidWebSocket';

interface Props {
  bidSessionId: string;
  initialSeq: number;
  meMemberId: number;
  jwt: string;
  initialFills: Record<string, { memberId: number; ordinal: number; bidId: string }>;
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
  members,
  wsBase,
}: Props) {
  const store = useMemo(() => {
    const s = createBidStore({ bidSessionId, initialSeq, meMemberId });
    s.setState({ fills: initialFills });
    return s;
  }, [bidSessionId, initialSeq, meMemberId, initialFills]);
  const { status } = useBidWebSocket(store, { bidSessionId, jwt, wsBase });
  const lastError = useStore(store, (s: BidStoreState) => s.lastError);
  return (
    <BidStoreProvider store={store}>
      <StationGroupedGrid members={members} />
      {status !== 'open' ? <ReconnectingOverlay status={status} /> : null}
      {lastError ? (
        <ErrorToast error={lastError} onClose={() => store.getState().clearError()} />
      ) : null}
    </BidStoreProvider>
  );
}
