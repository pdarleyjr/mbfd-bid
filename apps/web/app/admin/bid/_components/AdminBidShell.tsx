'use client';
import type { BidAdvisoryBundle } from '@mbfd/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { BidderContext } from '../../../_components/bid/BidderCard';
import type { MemberLite, PositionMeta, Shift } from '../../../_components/bid/types';
import { ShiftExportMenu } from '../../exports/_components/ShiftExports';
import { AdminBoard } from './AdminBoard';
import { AnnualLiveControls } from './AnnualLiveControls';
import {
  AnnualOperationsStatus,
  type AnnualOperationsStatusPayload,
} from './AnnualOperationsStatus';
import { BidOperatorProvider } from './BidOperatorContext';
import { BidOperatorWorkspace } from './BidOperatorWorkspace';
import { BidRoster } from './BidRoster';
import { BidSessionSetup } from './BidSessionSetup';
import { LiveCommandBar } from './LiveCommandBar';
import { ManualPickBar } from './ManualPickBar';
import { ManualPickProvider } from './ManualPickContext';
import { SessionPresentationLink } from './SessionPresentationLink';

interface BidOrderEntry {
  ordinal: number;
  memberId: number;
  pool: 'OFC' | 'FF';
}

interface Props {
  bidSessionId: string;
  bidYear?: number | null | undefined;
  lastSeq: number;
  currentPhase: string;
  currentBidderId: number | null;
  currentBidder: BidderContext | null;
  onDeck: BidderContext[];
  bidOrder: BidOrderEntry[];
  bidOrderPreview: boolean;
  sessionStartedAt: number | null;
  turnStartedAtMs: number;
  turnPausedAtMs?: number | null;
  turnTimerSeconds: number;
  meMemberId: number;
  initialFills: Record<string, { memberId: number; ordinal: number; bidId: string }>;
  members: Record<string, MemberLite>;
  /** Immutable material returned by /api/board for this exact session. */
  positions?: readonly PositionMeta[] | undefined;
  wsBase: string;
  /** Drives which manual-pick endpoint the UI calls; mock commands still require fresh admin auth. */
  isMock: boolean;
  /** D1 mock-control revision passed to the mock-only manual command. */
  mockControlRevision: number | null;
  annual?: AnnualOperationsStatusPayload | null | undefined;
  advisory: BidAdvisoryBundle | null;
}

/**
 * Page-level admin shell. Keeps the page server-component thin: it fetches
 * the snapshot and passes operational data down to the client controls.
 */
export function AdminBidShell(props: Props) {
  const router = useRouter();
  const refreshCanonical = useCallback(() => router.refresh(), [router]);
  const managed = props.annual !== null && props.annual !== undefined;
  const configuring = props.currentPhase === 'config';
  const [selectedShift, setSelectedShift] = useState<Shift>('A');
  const [workspaceState, setWorkspaceState] = useState({
    aDayPendingMemberIds: [] as number[],
    aDayDueMemberIds: [] as number[],
    temporarilyAssignedMemberIds: [] as number[],
  });
  const onWorkspaceStateChange = useCallback(
    (state: typeof workspaceState) => setWorkspaceState(state),
    [],
  );
  const board = (
    <AdminBoard
      bidSessionId={props.bidSessionId}
      initialSeq={props.lastSeq}
      meMemberId={props.meMemberId}
      initialFills={props.initialFills}
      initialCurrentBidderId={props.currentBidderId}
      members={props.members}
      positions={props.positions}
      wsBase={props.wsBase}
      advisory={props.advisory}
      managed={managed && !configuring}
      workspace
      selectedShift={selectedShift}
      onShiftChange={setSelectedShift}
    />
  );
  return (
    <ManualPickProvider
      bidSessionId={props.bidSessionId}
      isMock={props.isMock}
      mockControlRevision={props.mockControlRevision}
    >
      <BidOperatorProvider key={props.bidSessionId} currentBidderId={props.currentBidderId}>
        <div className="flex h-full min-h-0 flex-col">
          {configuring || !managed ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-1">
              <SessionPresentationLink sessionId={props.bidSessionId} isMock={props.isMock} />
              {configuring ? (
                <ShiftExportMenu sessionId={props.bidSessionId} currentShift={selectedShift} />
              ) : null}
            </div>
          ) : null}
          {!configuring && (
            <LiveCommandBar
              bidSessionId={props.bidSessionId}
              isMock={props.isMock}
              lastSeq={props.lastSeq}
              currentPhase={props.currentPhase}
              sessionStartedAt={props.sessionStartedAt}
              turnStartedAtMs={props.turnStartedAtMs > 0 ? props.turnStartedAtMs : null}
              turnPausedAtMs={props.turnPausedAtMs ?? null}
              turnTimerSeconds={props.turnTimerSeconds}
              currentBidder={props.currentBidder}
              currentBidderId={props.currentBidderId}
              onDeck={props.onDeck}
              managed={managed}
              exportControl={
                <ShiftExportMenu sessionId={props.bidSessionId} currentShift={selectedShift} />
              }
              presentationLink={
                managed ? (
                  <SessionPresentationLink
                    sessionId={props.bidSessionId}
                    isMock={props.isMock}
                    compact
                    variant="link"
                  />
                ) : undefined
              }
              presentationTools={
                managed ? (
                  <SessionPresentationLink
                    sessionId={props.bidSessionId}
                    isMock={props.isMock}
                    compact
                    variant="copy"
                  />
                ) : undefined
              }
            />
          )}
          {managed || configuring ? (
            <BidOperatorWorkspace
              sessionId={props.bidSessionId}
              minimumSequence={props.lastSeq}
              bidYear={props.bidYear}
              members={props.members}
              bidOrder={props.bidOrder}
              fills={props.initialFills}
              positions={props.positions}
              onDeckMemberIds={props.onDeck.map((member) => member.memberId)}
              {...workspaceState}
              preview={configuring}
              sessionDetails={
                !configuring ? <AnnualOperationsStatus annual={props.annual} /> : null
              }
            >
              {configuring ? (
                <>
                  <BidSessionSetup
                    bidSessionId={props.bidSessionId}
                    isMock={props.isMock}
                    memberCount={new Set(props.bidOrder.map((entry) => entry.memberId)).size}
                    onStarted={refreshCanonical}
                  />
                  {board}
                </>
              ) : (
                <AnnualLiveControls
                  bidSessionId={props.bidSessionId}
                  isMock={props.isMock}
                  currentBidderId={props.currentBidderId}
                  bidOrder={props.bidOrder}
                  fills={props.initialFills}
                  members={props.members}
                  positions={props.positions}
                  onCanonicalChange={refreshCanonical}
                  workspace
                  board={board}
                  onWorkspaceStateChange={onWorkspaceStateChange}
                />
              )}
            </BidOperatorWorkspace>
          ) : (
            <BidOperatorWorkspace
              sessionId={props.bidSessionId}
              minimumSequence={props.lastSeq}
              bidYear={props.bidYear}
              members={props.members}
              bidOrder={props.bidOrder}
              fills={props.initialFills}
              positions={props.positions}
              onDeckMemberIds={props.onDeck.map((member) => member.memberId)}
              sessionDetails={
                <>
                  <AnnualOperationsStatus annual={props.annual} />
                  <BidRoster
                    bidOrder={props.bidOrder}
                    members={props.members}
                    currentBidderId={props.currentBidderId}
                    fills={props.initialFills}
                    preview={props.bidOrderPreview}
                    currentPhase={props.currentPhase}
                    positions={props.positions}
                    snapshotBound
                  />
                </>
              }
            >
              <div className="shrink-0">
                <ManualPickBar isMock={props.isMock} members={props.members} />
              </div>
              <details className="shrink-0 border-b border-border px-3 text-sm">
                <summary className="min-h-11 cursor-pointer content-center font-semibold">
                  Bid actions
                </summary>
                <div className="max-h-72 overflow-y-auto">
                  <AnnualLiveControls
                    bidSessionId={props.bidSessionId}
                    isMock={props.isMock}
                    currentBidderId={props.currentBidderId}
                    bidOrder={props.bidOrder}
                    fills={props.initialFills}
                    members={props.members}
                    positions={props.positions}
                    onCanonicalChange={refreshCanonical}
                  />
                </div>
              </details>
              {board}
            </BidOperatorWorkspace>
          )}
        </div>
      </BidOperatorProvider>
    </ManualPickProvider>
  );
}
