'use client';
import { useEffect, useState } from 'react';
import { type StoreApi, useStore } from 'zustand';
import type { BidStoreState } from '../_hooks/useBidStore';
import { newIdempotencyKey } from '../_hooks/useIdempotencyKey';
import { EligibleList } from './EligibleList';

interface Props {
  store: StoreApi<BidStoreState>;
  send: (msg: object) => boolean;
  connectionStatus: 'connecting' | 'open' | 'closed';
  eligiblePositionIds: string[];
}

export function YourTurnPanel({ store, send, connectionStatus, eligiblePositionIds }: Props) {
  const meMemberId = useStore(store, (s) => s.meMemberId);
  const currentBidderId = useStore(store, (s) => s.currentBidderId);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [sendFailed, setSendFailed] = useState(false);

  useEffect(() => {
    if (connectionStatus === 'open') setSendFailed(false);
  }, [connectionStatus]);

  if (currentBidderId !== meMemberId) return null;

  const canSubmit = connectionStatus === 'open' && submitting === null && !sendFailed;

  const submit = (positionId: string) => {
    if (!canSubmit) return;
    const key = newIdempotencyKey();
    const acceptedBySocket = send({
      type: 'submit_pick',
      positionId,
      aDay: null,
      idempotencyKey: key,
    });
    if (!acceptedBySocket) {
      setSendFailed(true);
      return;
    }
    store.getState().markPendingMine(positionId, key);
    setSubmitting(positionId);
  };

  const connectionMessage =
    connectionStatus !== 'open'
      ? 'Pick actions are unavailable while the live connection is reconnecting. No pick was sent.'
      : sendFailed
        ? 'Your pick could not be sent. Reconnect before trying again; no pick was submitted.'
        : null;

  return (
    <section className="border-t border-red-700 bg-red-50 p-6">
      <h2 className="font-heading text-xl font-bold text-red-700">Your turn</h2>
      {connectionMessage ? (
        <output className="mt-2 text-sm font-medium text-red-800">{connectionMessage}</output>
      ) : null}
      <EligibleList
        positionIds={eligiblePositionIds}
        onPick={submit}
        submitting={submitting}
        disabled={!canSubmit}
      />
    </section>
  );
}
