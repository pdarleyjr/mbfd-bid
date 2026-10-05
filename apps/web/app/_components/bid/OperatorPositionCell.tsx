'use client';

import { useStore } from 'zustand';
import { useBidStoreContext } from '../../bid/_hooks/BidStoreContext';
import type { Fill } from '../../bid/_hooks/useBidStore';
import { getForcedAssignmentLabel, getSeatAppearance } from './seat-appearance';
import { type MemberLite, type PositionMeta, shortRank } from './types';

/** Compact operator row; presentation/member screens retain their own rich cells. */
export function OperatorPositionCell({
  position,
  members,
  onClick,
  openOnly = false,
}: {
  position: PositionMeta;
  members: Record<string, MemberLite>;
  onClick?: ((positionId: string) => void) | undefined;
  openOnly?: boolean;
}) {
  const store = useBidStoreContext();
  return store ? (
    <ConnectedCell
      store={store}
      position={position}
      members={members}
      onClick={onClick}
      openOnly={openOnly}
    />
  ) : (
    <Cell position={position} members={members} onClick={onClick} fill={null} pending={false} />
  );
}

function ConnectedCell({
  store,
  position,
  members,
  onClick,
  openOnly,
}: {
  store: NonNullable<ReturnType<typeof useBidStoreContext>>;
  position: PositionMeta;
  members: Record<string, MemberLite>;
  onClick?: ((positionId: string) => void) | undefined;
  openOnly: boolean;
}) {
  const fill = useStore(store, (state) => state.fills[position.id] ?? null);
  const pending = useStore(store, (state) => Boolean(state.pendingMine[position.id]));
  if (openOnly && fill) return null;
  return (
    <Cell position={position} members={members} onClick={onClick} fill={fill} pending={pending} />
  );
}

function Cell({
  position,
  members,
  onClick,
  fill,
  pending,
}: {
  position: PositionMeta;
  members: Record<string, MemberLite>;
  onClick?: ((positionId: string) => void) | undefined;
  fill: Fill | null;
  pending: boolean;
}) {
  const member = fill ? members[String(fill.memberId)] : null;
  const appearance = getSeatAppearance(position);
  const forcedLabel = getForcedAssignmentLabel(fill?.forced);
  const state = fill ? 'filled' : pending ? 'pending-mine' : 'open';
  const label = fill
    ? member
      ? `${shortRank(member.rank)} ${member.firstName} ${member.lastName}`
      : `Member ${fill.memberId}`
    : pending
      ? 'Submitting…'
      : 'Open';
  const props = {
    'data-testid': `position-cell-${position.id}`,
    'data-state': state,
    'data-seat-role': appearance.role,
    style: { backgroundColor: appearance.backgroundColor, color: appearance.color },
    className: `operator-position-row w-full border-b border-l-2 border-border px-2 py-2 text-left text-xs leading-4 ${fill ? 'border-l-emerald-700' : pending ? 'border-l-amber-700' : 'border-l-transparent'} ${onClick ? 'cursor-pointer hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring' : ''}`,
    title: `${position.id} · ${position.station} · ${position.unit} · ${position.positionName} · ${label}`,
  };
  const body = (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold tabular-nums">{position.id}</span>
        <span>{position.positionName}</span>
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
      </span>
      <span
        className={`mt-0.5 block ${fill ? 'font-semibold' : ''}`}
        style={{ color: fill ? appearance.color : appearance.mutedColor }}
        data-testid={fill ? `cell-filled-${position.id}` : undefined}
      >
        {label}
      </span>
    </>
  );
  return onClick ? (
    <button {...props} type="button" onClick={() => onClick(position.id)}>
      {body}
    </button>
  ) : (
    <div {...props}>{body}</div>
  );
}
