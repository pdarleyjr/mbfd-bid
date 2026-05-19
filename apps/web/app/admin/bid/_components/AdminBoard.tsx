'use client';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { ErrorToast } from '../../../bid/_components/ErrorToast';
import { PositionGrid } from '../../../bid/_components/PositionGrid';
import { ReconnectingOverlay } from '../../../bid/_components/ReconnectingOverlay';
import { BidStoreProvider } from '../../../bid/_hooks/BidStoreContext';
import { type BidStoreState, createBidStore } from '../../../bid/_hooks/useBidStore';
import { useBidWebSocket } from '../../../bid/_hooks/useBidWebSocket';
import { AdminActionsBar } from './AdminActionsBar';

interface Props {
  bidSessionId: string;
  initialSeq: number;
  meMemberId: number;
  jwt: string;
  initialFills: Record<string, { memberId: number; ordinal: number; bidId: string }>;
}

export function AdminBoard({ bidSessionId, initialSeq, meMemberId, jwt, initialFills }: Props) {
  const store = useMemo(() => {
    const s = createBidStore({ bidSessionId, initialSeq, meMemberId });
    s.setState({ fills: initialFills });
    return s;
  }, [bidSessionId, initialSeq, meMemberId, initialFills]);
  const { status } = useBidWebSocket(store, { bidSessionId, jwt });
  const lastError = useStore(store, (s: BidStoreState) => s.lastError);
  return (
    <BidStoreProvider store={store}>
      <AdminActionsBar bidSessionId={bidSessionId} jwt={jwt} />
      <PositionGrid fills={initialFills} />
      {status !== 'open' ? <ReconnectingOverlay status={status} /> : null}
      {lastError ? (
        <ErrorToast error={lastError} onClose={() => store.getState().clearError()} />
      ) : null}
    </BidStoreProvider>
  );
}
