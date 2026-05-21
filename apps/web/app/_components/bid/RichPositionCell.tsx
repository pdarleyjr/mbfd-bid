'use client';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';
import { useBidStoreContext } from '../../bid/_hooks/BidStoreContext';
import type { BidStoreState } from '../../bid/_hooks/useBidStore';
import { type MemberLite, type PositionMeta, shortRank } from './types';

interface Props {
  position: PositionMeta;
  /** Members map keyed by stringified id, baked into the board snapshot. */
  members: Record<string, MemberLite>;
  /** Optional click handler — admin board may wire this to force-pick UI. */
  onClick?: ((positionId: string) => void) | undefined;
}

/**
 * Position cell with the full layout the bid coordinators are used to:
 *   - position id badge (A101)
 *   - role line: rank + position name (Capt · Captain)
 *   - unit chip (Ladder 1)
 *   - filled-by member name (or "Open")
 */
export function RichPositionCell({ position, members, onClick }: Props) {
  const store = useBidStoreContext();
  return store ? (
    <LiveRichCell store={store} position={position} members={members} onClick={onClick} />
  ) : (
    <StaticRichCell position={position} members={members} fill={null} />
  );
}

interface CellBodyProps {
  position: PositionMeta;
  members: Record<string, MemberLite>;
  fill: { memberId: number; ordinal: number } | null;
  pending?: boolean | undefined;
  onClick?: ((positionId: string) => void) | undefined;
}

function CellBody({ position, members, fill, pending, onClick }: CellBodyProps) {
  const filledBy = fill ? members[String(fill.memberId)] : null;
  const state: 'filled' | 'pending-mine' | 'open' = fill
    ? 'filled'
    : pending
      ? 'pending-mine'
      : 'open';
  const isInteractive = typeof onClick === 'function';
  const baseClass = [
    'flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left text-sm transition-colors duration-fast ease-out-quart',
    state === 'filled'
      ? 'border-emerald-300 bg-emerald-50'
      : state === 'pending-mine'
        ? 'border-amber-300 bg-amber-50'
        : 'border-stone-200 bg-white hover:border-stone-300',
  ].join(' ');

  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-stone-700">{position.id}</span>
        <span className="text-[10px] uppercase tracking-wide text-stone-500">{position.unit}</span>
      </div>
      <div className="text-sm font-semibold text-stone-900">
        <span className="text-stone-500">{shortRank(position.rankRequired)} · </span>
        {position.positionName}
      </div>
      <div className="text-sm">
        {filledBy ? (
          <span data-testid={`cell-filled-${position.id}`} className="text-emerald-800">
            {shortRank(filledBy.rank)} {filledBy.firstName} {filledBy.lastName}
          </span>
        ) : pending ? (
          <span className="italic text-amber-700">Submitting…</span>
        ) : (
          <span className="text-stone-500">Open</span>
        )}
      </div>
    </>
  );

  return isInteractive ? (
    <button
      type="button"
      data-testid={`position-cell-${position.id}`}
      data-state={state}
      className={baseClass}
      onClick={() => onClick(position.id)}
    >
      {inner}
    </button>
  ) : (
    <div data-testid={`position-cell-${position.id}`} data-state={state} className={baseClass}>
      {inner}
    </div>
  );
}

function StaticRichCell({
  position,
  members,
  fill,
}: {
  position: PositionMeta;
  members: Record<string, MemberLite>;
  fill: { memberId: number; ordinal: number } | null;
}) {
  return <CellBody position={position} members={members} fill={fill} />;
}

function LiveRichCell({
  store,
  position,
  members,
  onClick,
}: {
  store: StoreApi<BidStoreState>;
  position: PositionMeta;
  members: Record<string, MemberLite>;
  onClick?: ((positionId: string) => void) | undefined;
}) {
  const fill = useStore(store, (s) => s.fills[position.id] ?? null);
  const pending = useStore(store, (s) => Boolean(s.pendingMine[position.id]));
  return (
    <CellBody
      position={position}
      members={members}
      fill={fill ? { memberId: fill.memberId, ordinal: fill.ordinal } : null}
      pending={pending}
      onClick={onClick}
    />
  );
}
