'use client';
import { useState } from 'react';
import { type StoreApi, useStore } from 'zustand';
import type { BidStoreState } from '../_hooks/useBidStore';
import { newIdempotencyKey } from '../_hooks/useIdempotencyKey';
import { EligibleList } from './EligibleList';

interface Props {
  store: StoreApi<BidStoreState>;
  send: (msg: object) => void;
  eligiblePositionIds: string[];
}

export function YourTurnPanel({ store, send, eligiblePositionIds }: Props) {
  const meMemberId = useStore(store, (s) => s.meMemberId);
  const currentBidderId = useStore(store, (s) => s.currentBidderId);
  const [submitting, setSubmitting] = useState<string | null>(null);

  if (currentBidderId !== meMemberId) return null;

  const submit = (positionId: string) => {
    const key = newIdempotencyKey();
    store.getState().markPendingMine(positionId, key);
    setSubmitting(positionId);
    send({ type: 'submit_pick', positionId, aDay: null, idempotencyKey: key });
  };

  return (
    <section className="border-t border-red-700 bg-red-50 p-6">
      <h2 className="font-display text-xl font-bold text-red-700">Your turn</h2>
      <EligibleList positionIds={eligiblePositionIds} onPick={submit} submitting={submitting} />
    </section>
  );
}
