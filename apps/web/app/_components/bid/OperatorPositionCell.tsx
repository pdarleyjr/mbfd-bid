'use client';

import { useStore } from 'zustand';
import { useBidStoreContext } from '../../bid/_hooks/BidStoreContext';
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
  fill: { memberId: number } | null;
  pending: boolean;
}) {
  const member = fill ? members[String(fill.memberId)] : null;
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
    className: `operator-position-row w-full border-b border-border px-2 py-2 text-left text-xs leading-4 ${fill ? 'bg-success/10' : 'bg-card'} ${onClick ? 'hover:bg-info/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring' : ''}`,
    title: `${position.id} · ${position.station} · ${position.unit} · ${position.positionName} · ${label}`,
  };
  const body = (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold tabular-nums">{position.id}</span>
        <span>{position.positionName}</span>
      </span>
      <span
        className={`mt-0.5 block ${fill ? 'font-semibold text-success' : 'text-muted-foreground'}`}
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
