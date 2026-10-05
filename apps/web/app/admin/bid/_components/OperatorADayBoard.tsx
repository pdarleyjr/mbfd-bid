'use client';

import {
  getForcedAssignmentLabel,
  getSeatAppearance,
} from '../../../_components/bid/seat-appearance';
import type { MemberLite, PositionMeta, Shift } from '../../../_components/bid/types';
import { useBidOperator } from './BidOperatorContext';
import { projectADayBoard } from './operator-a-day-board';

export function OperatorADayBoard({
  sessionId,
  shift,
  positions,
  members,
  minimumSequence = 0,
}: {
  sessionId: string;
  shift: Shift;
  positions: readonly PositionMeta[];
  members: Record<string, MemberLite>;
  minimumSequence?: number;
}) {
  const operator = useBidOperator();
  const projection = operator?.aDayProjection;
  if (!projection || projection.sessionId !== sessionId || projection.sequence < minimumSequence)
    return <output className="p-3 text-sm">Loading A-Days…</output>;
  const board = projectADayBoard(projection, positions, shift);
  const selectedSeat = Object.entries(projection.fills).find(
    ([, fill]) => fill.member_id === operator.selectedMemberId,
  );
  const selectedPosition = positions.find((position) => position.id === selectedSeat?.[0]);
  const canChoose =
    operator.overrideAllowed &&
    operator.selectedMemberId !== null &&
    (!selectedPosition || selectedPosition.shift === shift);
  function seatButton(seat: ReturnType<typeof projectADayBoard>['pending'][number]) {
    const member = members[String(seat.memberId)];
    const appearance = getSeatAppearance(seat.position);
    const forcedLabel =
      seat.forced === true ? 'Forced assignment' : getForcedAssignmentLabel(seat.forced);
    return (
      <button
        key={seat.position.id}
        type="button"
        className="min-h-11 w-full rounded border border-black/10 px-2 py-1 text-left text-xs focus-visible:outline focus-visible:outline-2"
        style={{ backgroundColor: appearance.backgroundColor, color: appearance.color }}
        onClick={() => {
          operator?.selectMember(seat.memberId);
          if (operator?.overrideAllowed)
            operator.requestADay(seat.aDay ?? '', seat.memberId, seat.position.id, shift);
        }}
        aria-label={`${seat.position.id} ${member ? `${member.firstName} ${member.lastName}` : `Member ${seat.memberId}`} ${seat.aDay ? `A-Day ${seat.aDay}` : 'A-Day pending'}`}
      >
        <strong>{seat.position.id}</strong> ·{' '}
        {member ? `${member.firstName} ${member.lastName}` : `Member ${seat.memberId}`}
        {forcedLabel ? (
          <span
            className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 font-bold text-amber-900"
            title={forcedLabel}
            aria-label={forcedLabel}
          >
            !
          </span>
        ) : null}
        <span className="block">{seat.position.positionName}</span>
      </button>
    );
  }
  return (
    <section
      id={`shift-panel-${shift}`}
      role="tabpanel"
      aria-labelledby={`shift-tab-${shift}`}
      aria-label={`${shift} shift A-Day board`}
      className="min-h-0 flex-1 overflow-auto p-2"
    >
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {board.groups.map((group) => (
          <section
            key={group.id}
            aria-label={`A-Day ${group.id}`}
            className="min-w-0 rounded border border-border"
          >
            <header className="flex items-center justify-between gap-2 bg-muted px-2 py-2 text-sm">
              <strong>{shift === 'D' ? group.id : `Group ${group.id.slice(1)}`}</strong>
              <span className="text-xs">
                {group.taken.length} selected
                {group.remaining === null ? '' : ` · ${group.remaining} available`}
              </span>
            </header>
            <div className="grid gap-1 p-1">
              {group.taken.map(seatButton)}
              <button
                type="button"
                disabled={!canChoose}
                className="min-h-11 rounded border border-dashed border-border px-2 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                onClick={() =>
                  operator.requestADay(group.id, undefined, selectedPosition?.id, shift)
                }
              >
                {group.remaining === 0 ? 'Review full group' : 'Select this A-Day'}
              </button>
            </div>
          </section>
        ))}
      </div>
      {board.pending.length ? (
        <section aria-label="A-Days pending" className="mt-3">
          <h3 className="mb-1 text-sm font-semibold">A-Day pending · {board.pending.length}</h3>
          <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-4">
            {board.pending.map(seatButton)}
          </div>
        </section>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">
        Select a member, then a group. Staffing advisories appear during review.
      </p>
    </section>
  );
}
