'use client';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { type BidStoreState, createBidStore } from '../_hooks/useBidStore';
import { useBidWebSocket } from '../_hooks/useBidWebSocket';
import { ErrorToast } from './ErrorToast';
import { ReconnectingOverlay } from './ReconnectingOverlay';

interface Props {
  bidSessionId: string;
  initialSeq: number;
  meMemberId: number;
  jwt: string;
}

export function BidBoard({ bidSessionId, initialSeq, meMemberId, jwt }: Props) {
  const store = useMemo(
    () => createBidStore({ bidSessionId, initialSeq, meMemberId }),
    [bidSessionId, initialSeq, meMemberId],
  );
  const { status } = useBidWebSocket(store, { bidSessionId, jwt });
  const lastError = useStore(store, (s: BidStoreState) => s.lastError);
  return (
    <>
      {status !== 'open' ? <ReconnectingOverlay status={status} /> : null}
      {lastError ? (
        <ErrorToast error={lastError} onClose={() => store.getState().clearError()} />
      ) : null}
    </>
  );
}
