'use client';
import type { BidderContext } from '../../../_components/bid/BidderCard';
import type { MemberLite, PositionMeta } from '../../../_components/bid/types';
import { AdminBoard } from './AdminBoard';
import {
  AnnualOperationsStatus,
  type AnnualOperationsStatusPayload,
} from './AnnualOperationsStatus';
import { BidRoster } from './BidRoster';
import { LiveCommandBar } from './LiveCommandBar';
import { ManualPickBar } from './ManualPickBar';
import { ManualPickProvider } from './ManualPickContext';

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
}

/**
 * Page-level admin shell. Keeps the page server-component thin: it fetches
 * the snapshot and passes operational data down to the client controls.
 */
export function AdminBidShell(props: Props) {
  return (
    <ManualPickProvider
      bidSessionId={props.bidSessionId}
      isMock={props.isMock}
      mockControlRevision={props.mockControlRevision}
    >
      <div className="flex h-full min-h-[calc(100vh-57px)] flex-col">
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
        />

        <AnnualOperationsStatus annual={props.annual} />

        <ManualPickBar isMock={props.isMock} members={props.members} />

        <BidRoster
          bidOrder={props.bidOrder}
          members={props.members}
          currentBidderId={props.currentBidderId}
          fills={props.initialFills}
          preview={props.bidOrderPreview}
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
            />
          </div>
        </div>
      </div>
    </ManualPickProvider>
  );
}
