'use client';
import { useState } from 'react';
import type { BidderContext } from '../../../_components/bid/BidderCard';
import type { MemberLite } from '../../../_components/bid/types';
import { AIAdvisoryPanel } from './AIAdvisoryPanel';
import { AIAskDeepDialog } from './AIAskDeepDialog';
import { AIForecastBanner } from './AIForecastBanner';
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
 * Page-level admin shell. Owns the AI-panel open/closed state so the command
 * bar's toggle and the right-side drawer stay in sync. Keeps the page
 * server-component thin: it just fetches the snapshot and passes the data
 * down to this client.
 */
export function AdminBidShell(props: Props) {
  const [aiPanelOpen, setAiPanelOpen] = useState(true);

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
          aiPanelOpen={aiPanelOpen}
          onToggleAiPanel={() => setAiPanelOpen((v) => !v)}
        />

        <ManualPickBar isMock={props.isMock} members={props.members} />

        <AIForecastBanner bidSessionId={props.bidSessionId} />

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
              members={props.members}
              wsBase={props.wsBase}
            />
          </div>
          {aiPanelOpen && (
            <aside
              data-testid="ai-side-panel"
              className="flex w-[360px] shrink-0 flex-col border-l border-stone-200 bg-white"
            >
              {props.currentBidderId === null ? (
                <div
                  data-testid="ai-panel-idle"
                  className="border-b border-stone-200 bg-stone-50 p-4 text-sm text-stone-600"
                >
                  <h2 className="mb-1 font-semibold text-stone-900">AI Advisor</h2>
                  <p>
                    Idle — the AI advisor activates the moment the first bidder takes their turn.
                    Until then there&apos;s nothing to advise on. Phase:{' '}
                    <span className="font-mono text-stone-800">{props.currentPhase}</span>.
                  </p>
                </div>
              ) : (
                <AIAdvisoryPanel
                  bidSessionId={props.bidSessionId}
                  turnTimerSeconds={props.turnTimerSeconds}
                />
              )}
              <div className="border-t border-stone-200 p-3">
                <AIAskDeepDialog bidSessionId={props.bidSessionId} />
              </div>
            </aside>
          )}
        </div>
      </div>
    </ManualPickProvider>
  );
}
