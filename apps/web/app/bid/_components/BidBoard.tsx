'use client';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { BidStoreProvider } from '../_hooks/BidStoreContext';
import { type BidStoreState, createBidStore } from '../_hooks/useBidStore';
import { useBidWebSocket } from '../_hooks/useBidWebSocket';
import { ErrorToast } from './ErrorToast';
import { PositionGrid } from './PositionGrid';
import { ReconnectingOverlay } from './ReconnectingOverlay';
import { YourTurnPanel } from './YourTurnPanel';

interface Props {
  bidSessionId: string;
  initialSeq: number;
  meMemberId: number;
  jwt: string;
  initialFills: Record<string, { memberId: number; ordinal: number; bidId: string }>;
  eligiblePositionIds: string[];
}

export function BidBoard({
  bidSessionId,
  initialSeq,
  meMemberId,
  jwt,
  initialFills,
  eligiblePositionIds,
}: Props) {
  const store = useMemo(() => {
    const s = createBidStore({ bidSessionId, initialSeq, meMemberId });
    s.setState({ fills: initialFills });
    return s;
  }, [bidSessionId, initialSeq, meMemberId, initialFills]);
  const { status, send } = useBidWebSocket(store, { bidSessionId, jwt });
  const lastError = useStore(store, (s: BidStoreState) => s.lastError);
  return (
    <BidStoreProvider store={store}>
      <PositionGrid fills={initialFills} />
      <YourTurnPanel store={store} send={send} eligiblePositionIds={eligiblePositionIds} />
      {status !== 'open' ? <ReconnectingOverlay status={status} /> : null}
      {lastError ? (
        <ErrorToast error={lastError} onClose={() => store.getState().clearError()} />
      ) : null}
    </BidStoreProvider>
  );
}
