'use client';
import { Button } from '@/components/ui/button';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';
import { useBidStoreContext } from '../../bid/_hooks/BidStoreContext';
import type { BidStoreState, Fill } from '../../bid/_hooks/useBidStore';
import { getForcedAssignmentLabel, getSeatAppearance } from './seat-appearance';
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
    <StaticRichCell position={position} members={members} fill={null} onClick={onClick} />
  );
}

interface CellBodyProps {
  position: PositionMeta;
  members: Record<string, MemberLite>;
  fill: Fill | null;
  pending?: boolean | undefined;
  onClick?: ((positionId: string) => void) | undefined;
}

function CellBody({ position, members, fill, pending, onClick }: CellBodyProps) {
  const filledBy = fill ? members[String(fill.memberId)] : null;
  const appearance = getSeatAppearance(position);
  const forcedLabel = getForcedAssignmentLabel(fill?.forced);
  const state: 'filled' | 'pending-mine' | 'open' = fill
    ? 'filled'
    : pending
      ? 'pending-mine'
      : 'open';
  const isInteractive = typeof onClick === 'function';
  const baseClass = [
    'flex w-full flex-col rounded border px-2 py-1 text-left text-xs leading-snug transition-colors duration-fast ease-out-quart',
    state === 'filled'
      ? 'border-emerald-700'
      : state === 'pending-mine'
        ? 'border-amber-700'
        : isInteractive
          ? 'border-border hover:border-blue-600 hover:brightness-95 cursor-pointer'
          : 'border-border',
  ].join(' ');

  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold">{position.id}</span>
        <span
          className="text-[9px] uppercase tracking-wide"
          style={{ color: appearance.mutedColor }}
        >
          {position.unit}
        </span>
      </div>
      <div className="flex items-center gap-1 text-xs font-semibold">
        <span style={{ color: appearance.mutedColor }}>{shortRank(position.rankRequired)} · </span>
        {position.positionName}
        {forcedLabel ? (
          <span
            role="img"
            aria-label={forcedLabel}
            title={forcedLabel}
            data-testid={`forced-marker-${position.id}`}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-amber-900 bg-white text-xs font-extrabold text-amber-950"
          >
            !
          </span>
        ) : null}
      </div>
      <div className="text-[11px]">
        {filledBy ? (
          <span data-testid={`cell-filled-${position.id}`} className="font-semibold">
            {shortRank(filledBy.rank)} {filledBy.firstName} {filledBy.lastName}
          </span>
        ) : pending ? (
          <span className="italic" style={{ color: appearance.mutedColor }}>
            Submitting…
          </span>
        ) : (
          <span style={{ color: appearance.mutedColor }}>Open</span>
        )}
      </div>
    </>
  );

  return isInteractive ? (
    <Button
      type="button"
      data-testid={`position-cell-${position.id}`}
      data-state={state}
      data-seat-role={appearance.role}
      style={{ backgroundColor: appearance.backgroundColor, color: appearance.color }}
      className={baseClass}
      onClick={() => onClick(position.id)}
    >
      {inner}
    </Button>
  ) : (
    <div
      data-testid={`position-cell-${position.id}`}
      data-state={state}
      data-seat-role={appearance.role}
      style={{ backgroundColor: appearance.backgroundColor, color: appearance.color }}
      className={baseClass}
    >
      {inner}
    </div>
  );
}

function StaticRichCell({
  position,
  members,
  fill,
  onClick,
}: {
  position: PositionMeta;
  members: Record<string, MemberLite>;
  fill: Fill | null;
  onClick?: ((positionId: string) => void) | undefined;
}) {
  return <CellBody position={position} members={members} fill={fill} onClick={onClick} />;
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
      fill={fill}
      pending={pending}
      onClick={onClick}
    />
  );
}
