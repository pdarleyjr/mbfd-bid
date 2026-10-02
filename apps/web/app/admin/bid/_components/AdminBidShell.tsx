'use client';
import type { BidAdvisoryBundle } from '@mbfd/shared';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import type { BidderContext } from '../../../_components/bid/BidderCard';
import type { MemberLite, PositionMeta } from '../../../_components/bid/types';
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
  lastSeq: number;
  currentPhase: string;
  currentBidderId: number | null;
  currentBidder: BidderContext | null;
  onDeck: BidderContext[];
  bidOrder: BidOrderEntry[];
  bidOrderPreview: boolean;
  sessionStartedAt: number | null;
  turnStartedAtMs: number;
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
  return (
    <ManualPickProvider
      bidSessionId={props.bidSessionId}
      isMock={props.isMock}
      mockControlRevision={props.mockControlRevision}
    >
      <BidOperatorProvider currentBidderId={props.currentBidderId}>
        <div className="flex h-full min-h-[calc(100vh-57px)] flex-col">
          <div className="border-b border-border bg-card px-3 py-2 sm:px-5">
            <SessionPresentationLink sessionId={props.bidSessionId} isMock={props.isMock} />
          </div>
          {!configuring && (
            <LiveCommandBar
              bidSessionId={props.bidSessionId}
              isMock={props.isMock}
              lastSeq={props.lastSeq}
              currentPhase={props.currentPhase}
              sessionStartedAt={props.sessionStartedAt}
              turnStartedAtMs={props.turnStartedAtMs > 0 ? props.turnStartedAtMs : null}
              turnTimerSeconds={props.turnTimerSeconds}
              currentBidder={props.currentBidder}
              currentBidderId={props.currentBidderId}
              onDeck={props.onDeck}
              managed={managed}
            />
          )}
          {managed || configuring ? (
            <BidOperatorWorkspace
              members={props.members}
              bidOrder={props.bidOrder}
              preview={configuring}
            >
              {configuring ? (
                <BidSessionSetup
                  bidSessionId={props.bidSessionId}
                  isMock={props.isMock}
                  memberCount={new Set(props.bidOrder.map((entry) => entry.memberId)).size}
                  onStarted={refreshCanonical}
                />
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
                />
              )}
              <details className="border border-border bg-card">
                <summary className="cursor-pointer px-3 py-3 text-sm font-semibold">
                  Full board, roster, and session status
                </summary>
                {!configuring && <AnnualOperationsStatus annual={props.annual} />}
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
                  managed={!configuring}
                />
              </details>
            </BidOperatorWorkspace>
          ) : (
            <>
              <AnnualOperationsStatus annual={props.annual} />

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

              <ManualPickBar isMock={props.isMock} members={props.members} />

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

              <div className="flex min-h-0 flex-1 flex-row">
                <div className="min-w-0 flex-1 overflow-auto">
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
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </BidOperatorProvider>
    </ManualPickProvider>
  );
}
