'use client';
import type { BidderContext } from '../../../_components/bid/BidderCard';
import type { MemberLite } from '../../../_components/bid/types';
import { AdminBoard } from './AdminBoard';
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
  jwt: string;
  initialFills: Record<string, { memberId: number; ordinal: number; bidId: string }>;
  members: Record<string, MemberLite>;
  wsBase: string;
  /** Drives which manual-pick endpoint the UI calls (mock → no step-up). */
  isMock: boolean;
}

/**
 * Page-level admin shell. Keeps the page server-component thin: it fetches
 * the snapshot and passes operational data down to the client controls.
 */
export function AdminBidShell(props: Props) {
  return (
    <ManualPickProvider bidSessionId={props.bidSessionId} isMock={props.isMock}>
      <div className="flex h-full min-h-[calc(100vh-57px)] flex-col">
        <LiveCommandBar
          bidSessionId={props.bidSessionId}
          jwt={props.jwt}
          currentPhase={props.currentPhase}
          sessionStartedAt={props.sessionStartedAt}
          turnStartedAtMs={props.turnStartedAtMs > 0 ? props.turnStartedAtMs : null}
          turnTimerSeconds={props.turnTimerSeconds}
          currentBidder={props.currentBidder}
          currentBidderId={props.currentBidderId}
          onDeck={props.onDeck}
        />

        <ManualPickBar isMock={props.isMock} members={props.members} />

        <BidRoster
          bidOrder={props.bidOrder}
          members={props.members}
          currentBidderId={props.currentBidderId}
          fills={props.initialFills}
          preview={props.bidOrderPreview}
        />

        <div className="flex min-h-0 flex-1 flex-row">
          <div className="min-w-0 flex-1 overflow-auto">
            <AdminBoard
              bidSessionId={props.bidSessionId}
              initialSeq={props.lastSeq}
              meMemberId={props.meMemberId}
              jwt={props.jwt}
              initialFills={props.initialFills}
              initialCurrentBidderId={props.currentBidderId}
              members={props.members}
              wsBase={props.wsBase}
            />
          </div>
        </div>
      </div>
    </ManualPickProvider>
  );
}
