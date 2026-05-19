'use client';
import { useStore } from 'zustand';
import { useBidStoreContext } from '../_hooks/BidStoreContext';

interface Props {
  positionId: string;
  fill: { memberId: number; ordinal: number; bidId: string } | null;
}

export function PositionCell({ positionId, fill }: Props) {
  const store = useBidStoreContext();
  return store ? (
    <LiveCell positionId={positionId} store={store} />
  ) : (
    <StaticCell positionId={positionId} fill={fill} />
  );
}

function StaticCell({ positionId, fill }: Props) {
  const state = fill ? 'filled' : 'eligible-open';
  return (
    <div
      data-testid={`position-cell-${positionId}`}
      data-state={state}
      className="rounded border border-stone-200 bg-white p-3 text-sm tabular-nums"
    >
      <div className="font-mono text-xs text-stone-500">{positionId}</div>
      <div className="mt-1 text-stone-900">
        {fill ? `Filled by member ${fill.memberId}` : 'Open'}
      </div>
    </div>
  );
}

interface LiveProps {
  positionId: string;
  store: NonNullable<ReturnType<typeof useBidStoreContext>>;
}

function LiveCell({ positionId, store }: LiveProps) {
  const fill = useStore(store, (s) => s.fills[positionId] ?? null);
  const pending = useStore(store, (s) => s.pendingMine[positionId] ?? null);
  let state: 'filled' | 'pending-mine' | 'eligible-open';
  if (fill) state = 'filled';
  else if (pending) state = 'pending-mine';
  else state = 'eligible-open';
  return (
    <div
      data-testid={`position-cell-${positionId}`}
      data-state={state}
      className="rounded border border-stone-200 bg-white p-3 text-sm tabular-nums"
    >
      <div className="font-mono text-xs text-stone-500">{positionId}</div>
      <div className="mt-1 text-stone-900">
        {fill ? `Filled by member ${fill.memberId}` : pending ? 'Submitting…' : 'Open'}
      </div>
    </div>
  );
}
