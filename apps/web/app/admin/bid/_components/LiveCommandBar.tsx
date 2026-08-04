'use client';
import { useEffect, useState } from 'react';
import { BidderCard, type BidderContext } from '../../../_components/bid/BidderCard';
import { FreezeConfirmDialog } from './FreezeConfirmDialog';
import { useManualPick } from './ManualPickContext';
import { OverrideDialog } from './OverrideDialog';

interface Props {
  bidSessionId: string;
  jwt: string;
  currentPhase: string;
  sessionStartedAt: number | null;
  turnStartedAtMs: number | null;
  turnTimerSeconds: number;
  currentBidder: BidderContext | null;
  currentBidderId: number | null;
  onDeck: ReadonlyArray<BidderContext>;
}

function formatDuration(ms: number): string {
  if (ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

function useTick(intervalMs = 1000): number {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return Date.now();
}

/**
 * Pinned admin command bar — every operational signal and every control in
 * one row so the chief running the bid never has to scroll to act:
 *   - phase chip
 *   - session uptime
 *   - turn countdown (turns amber under 30s, red under 10s, "—" between turns)
 *   - active bidder with name + rank
 *   - on-deck strip (next 5)
 *   - Skip / Override / Freeze (explicit text colors so the buttons can't go
 *     white-on-white when the admin layout's text-slate-50 leaks through)
 */
export function LiveCommandBar({
  bidSessionId,
  jwt,
  currentPhase,
  sessionStartedAt,
  turnStartedAtMs,
  turnTimerSeconds,
  currentBidder,
  currentBidderId,
  onDeck,
}: Props) {
  const now = useTick(1000);
  const [open, setOpen] = useState<'override' | 'freeze' | null>(null);
  const [busy, setBusy] = useState(false);
  const { pickMode, setPickMode } = useManualPick();

  const sessionUptime =
    sessionStartedAt && sessionStartedAt > 0 ? formatDuration(now - sessionStartedAt) : '—';
  const remainingMs =
    turnStartedAtMs && turnStartedAtMs > 0
      ? Math.max(0, turnStartedAtMs + turnTimerSeconds * 1000 - now)
      : 0;
  const turnDisplay = turnStartedAtMs && turnStartedAtMs > 0 ? formatDuration(remainingMs) : '—';
  const turnUrgency: 'normal' | 'warn' | 'critical' =
    remainingMs === 0
      ? 'normal'
      : remainingMs < 10_000
        ? 'critical'
        : remainingMs < 30_000
          ? 'warn'
          : 'normal';
  const turnColor =
    turnUrgency === 'critical'
      ? 'text-red-600'
      : turnUrgency === 'warn'
        ? 'text-amber-600'
        : 'text-stone-900';

  async function onSkip() {
    if (busy) return;
    const reason = prompt('Skip reason?');
    if (!reason) return;
    setBusy(true);
    try {
      await fetch('/api/admin/bid/skip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ bidSessionId, reason }),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <header data-testid="live-command-bar" className="border-b border-stone-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 text-stone-900">
        <div className="flex items-baseline gap-2">
          <h1 className="font-display text-lg font-bold">MBFD Annual Bid</h1>
          <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-stone-700">
            {currentPhase}
          </span>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <span title="Session uptime">
            <span className="text-stone-500">Session</span>{' '}
            <span data-testid="session-uptime" className="font-mono tabular-nums">
              {sessionUptime}
            </span>
          </span>
          <span title="Turn timer">
            <span className="text-stone-500">Turn</span>{' '}
            <span
              data-testid="turn-remaining"
              data-urgency={turnUrgency}
              className={`font-mono tabular-nums font-semibold ${turnColor}`}
            >
              {turnDisplay}
            </span>
          </span>
        </div>

        <div className="min-w-0 flex-1 text-sm">
          <span className="mr-2 text-stone-500">Active:</span>
          <BidderCard bidder={currentBidder} fallbackMemberId={currentBidderId} />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="admin-action-pick-mode"
            onClick={() => setPickMode(!pickMode)}
            aria-pressed={pickMode}
            className={
              pickMode
                ? 'rounded border border-blue-700 bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600'
                : 'rounded border border-blue-700 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-900 hover:bg-blue-100'
            }
          >
            {pickMode ? 'Pick mode: ON' : 'Pick for member'}
          </button>
          <button
            type="button"
            data-testid="admin-action-skip"
            disabled={busy}
            onClick={onSkip}
            className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-900 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Skip
          </button>
          <button
            type="button"
            data-testid="admin-action-override"
            onClick={() => setOpen('override')}
            className="rounded border border-red-700 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100"
          >
            Override
          </button>
          <button
            type="button"
            data-testid="admin-action-freeze"
            onClick={() => setOpen('freeze')}
            className="rounded border border-amber-600 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            Freeze
          </button>
        </div>
      </div>

      {onDeck.length > 0 && (
        <div
          data-testid="on-deck-strip"
          className="flex items-center gap-3 overflow-x-auto border-t border-stone-100 bg-stone-50 px-4 py-1.5 text-sm"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            On deck
          </span>
          {onDeck.map((b, i) => (
            <span key={b.memberId} className="flex shrink-0 items-baseline gap-1 text-stone-800">
              <span className="rounded-full bg-stone-200 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-stone-700">
                {i + 1}
              </span>
              <BidderCard bidder={b} fallbackMemberId={b.memberId} compact />
            </span>
          ))}
        </div>
      )}

      {open === 'override' ? (
        <OverrideDialog bidSessionId={bidSessionId} jwt={jwt} onClose={() => setOpen(null)} />
      ) : null}
      {open === 'freeze' ? (
        <FreezeConfirmDialog bidSessionId={bidSessionId} jwt={jwt} onClose={() => setOpen(null)} />
      ) : null}
    </header>
  );
}
