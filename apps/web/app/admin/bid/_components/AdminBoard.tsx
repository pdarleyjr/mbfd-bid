'use client';
import type { BidAdvisoryBundle } from '@mbfd/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { StationGroupedGrid } from '../../../_components/bid/StationGroupedGrid';
import { getSeatAppearance } from '../../../_components/bid/seat-appearance';
import type { MemberLite, PositionMeta, Shift } from '../../../_components/bid/types';
import { ErrorToast } from '../../../bid/_components/ErrorToast';
import { ReconnectingOverlay } from '../../../bid/_components/ReconnectingOverlay';
import { BidStoreProvider } from '../../../bid/_hooks/BidStoreContext';
import { type BidStoreState, type Fill, createBidStore } from '../../../bid/_hooks/useBidStore';
import { useBidWebSocket } from '../../../bid/_hooks/useBidWebSocket';
import { BidAdvisoryPanel } from './BidAdvisoryPanel';
import { useBidOperator } from './BidOperatorContext';
import { useManualPick } from './ManualPickContext';
import { OperatorADayBoard } from './OperatorADayBoard';

interface Props {
  bidSessionId: string;
  initialSeq: number;
  meMemberId: number;
  initialFills: Record<string, Fill>;
  /** Bidder the SSR snapshot believed was up — fed into the store so the
   *  client UI shows the right member before the WS connects (or if the WS
   *  state_snapshot ships currentBidderId=null because the DO is stale). */
  initialCurrentBidderId: number | null;
  members: Record<string, MemberLite>;
  /** Immutable material returned by /api/board for this exact session. */
  positions?: readonly PositionMeta[] | undefined;
  /** See BidBoard — Worker origin for the WebSocket upgrade (Pages domain
   *  doesn't proxy WS). */
  wsBase?: string;
  /** Server-composed explanation of the same authoritative board snapshot. */
  advisory: BidAdvisoryBundle | null;
  managed?: boolean;
  workspace?: boolean;
  selectedShift?: Shift | undefined;
  onShiftChange?: ((shift: Shift) => void) | undefined;
}

type AssignedPosition = PositionMeta & {
  readOnlyAssignment?: { memberId: number; name: string; rank: string };
};

export function AdminBoard({
  bidSessionId,
  initialSeq,
  meMemberId,
  initialFills,
  initialCurrentBidderId,
  members,
  positions,
  wsBase,
  advisory,
  managed = false,
  workspace = false,
  selectedShift,
  onShiftChange,
}: Props) {
  const operator = useBidOperator();
  const router = useRouter();
  const [localShift, setLocalShift] = useState<Shift>('A');
  const [aDayView, setADayView] = useState(false);
  const visibleShift = selectedShift ?? localShift;
  const store = useMemo(() => {
    const s = createBidStore({ bidSessionId, initialSeq, meMemberId });
    s.setState({ fills: initialFills, currentBidderId: initialCurrentBidderId });
    return s;
  }, [bidSessionId, initialSeq, meMemberId, initialFills, initialCurrentBidderId]);
  const { status } = useBidWebSocket(store, { bidSessionId, wsBase });
  const lastError = useStore(store, (s: BidStoreState) => s.lastError);
  const observedSequence = useStore(store, (s: BidStoreState) => s.lastSeq);
  const refreshedSequence = useRef(initialSeq);
  const { pickMode, selectedMemberId, submitPick } = useManualPick();
  const biddablePositions = useMemo(
    () =>
      positions?.filter(
        (position) => !position.bidParticipation || position.bidParticipation === 'BIDDABLE',
      ),
    [positions],
  );
  const assignedPositions = (positions as readonly AssignedPosition[] | undefined)?.filter(
    (position) =>
      position.shift === visibleShift &&
      position.bidParticipation !== undefined &&
      position.bidParticipation !== 'BIDDABLE' &&
      position.readOnlyAssignment,
  );

  // Position cells are interactive only when pick mode is on AND the admin
  // has already selected a member. The cell will be open-only (the filled-
  // cell case short-circuits the submit on the server with 409).
  const onPositionClick = useCallback(
    (positionId: string) => {
      if (!pickMode || selectedMemberId === null) return;
      void submitPick({ memberId: selectedMemberId, positionId });
    },
    [pickMode, selectedMemberId, submitPick],
  );
  const positionClickHandler = managed
    ? (positionId: string) => {
        const fill = store.getState().fills[positionId];
        if (fill) operator?.selectMember(fill.memberId);
        else operator?.choosePosition(positionId);
      }
    : pickMode && selectedMemberId !== null
      ? onPositionClick
      : undefined;

  useEffect(() => {
    refreshedSequence.current = Math.max(refreshedSequence.current, initialSeq);
  }, [initialSeq]);

  useEffect(() => {
    if (observedSequence <= refreshedSequence.current) return;
    refreshedSequence.current = observedSequence;
    // The socket supplies the immediate event projection. Refresh the server
    // component once so its advisory is recomposed from the authoritative
    // board read model at that exact sequence.
    router.refresh();
  }, [observedSequence, router]);

  return (
    <BidStoreProvider store={store}>
      <div
        className={workspace ? 'flex min-h-0 flex-1 flex-col' : undefined}
        data-testid="operator-board"
      >
        {!workspace ? <BidAdvisoryPanel advisory={advisory} /> : null}
        <StationGroupedGrid
          members={members}
          positions={biddablePositions}
          snapshotBound
          onPositionClick={positionClickHandler}
          operatorLayout={workspace}
          selectedShift={visibleShift}
          boardToggle={
            managed ? (
              <button
                type="button"
                aria-pressed={aDayView}
                onClick={() => setADayView((value) => !value)}
                className="min-h-11 rounded px-3 text-xs font-semibold hover:bg-muted aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              >
                A-Days
              </button>
            ) : undefined
          }
          alternateBoard={
            aDayView ? (
              <OperatorADayBoard
                sessionId={bidSessionId}
                minimumSequence={initialSeq}
                shift={visibleShift}
                positions={biddablePositions ?? []}
                members={members}
              />
            ) : undefined
          }
          onShiftChange={(shift) => {
            setLocalShift(shift);
            onShiftChange?.(shift);
          }}
          toolbar={
            workspace ? (
              <details className="relative text-xs">
                <summary className="min-h-11 cursor-pointer content-center whitespace-nowrap px-2 font-semibold">
                  Decision details
                  {advisory
                    ? ` · ${advisory.cards.filter((card) => card.severity === 'attention' || card.severity === 'blocked').length}`
                    : ''}
                </summary>
                <div className="absolute right-0 top-full z-30 max-h-60 w-[min(460px,calc(100vw-2rem))] overflow-auto rounded border border-border bg-card shadow-lg">
                  <BidAdvisoryPanel advisory={advisory} />
                </div>
              </details>
            ) : undefined
          }
          selectedRank={
            operator?.selectedMemberId == null
              ? null
              : (members[String(operator.selectedMemberId)]?.rank ?? null)
          }
        />
        {assignedPositions?.length ? (
          <section
            aria-label="Assigned positions"
            className="grid shrink-0 gap-1 px-2 py-1 sm:grid-cols-2 xl:grid-cols-4"
          >
            {assignedPositions.map((position) => (
              <div
                key={position.id}
                data-testid={`assigned-position-${position.id}`}
                className="min-w-0 rounded border border-border bg-muted/50 px-2 py-1 text-xs"
                style={{
                  backgroundColor: getSeatAppearance(position).backgroundColor,
                  color: getSeatAppearance(position).color,
                }}
              >
                <p className="truncate" title={`${position.id} · ${position.positionName}`}>
                  <strong>{position.id}</strong> · {position.positionName}
                </p>
                <p className="truncate font-semibold">
                  {position.readOnlyAssignment?.name}
                  <span className="ml-2 font-normal text-muted-foreground">Assigned</span>
                </p>
              </div>
            ))}
          </section>
        ) : null}
        {status !== 'open' ? <ReconnectingOverlay status={status} /> : null}
        {lastError ? (
          <ErrorToast error={lastError} onClose={() => store.getState().clearError()} />
        ) : null}
      </div>
    </BidStoreProvider>
  );
}
