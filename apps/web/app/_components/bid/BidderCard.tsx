/**
 * Bidder context card — displays "CPT Sola (14335) — A-side pool" instead of
 * the raw member id. Used in both the admin Live Bid Console header and the
 * member-facing bid page. Falls back to the id-only view when the Worker
 * couldn't enrich the snapshot (e.g. local dev without seeded members).
 */

export interface BidderContext {
  memberId: number;
  ordinal: number;
  pool: 'OFC' | 'FF';
  firstName: string;
  lastName: string;
  rank: string;
  employeeId: string;
}

const RANK_LABELS: Record<string, string> = {
  FF: 'FF',
  LT: 'LT',
  CPT: 'CPT',
  DC: 'DC',
  DEP_CHIEF: 'DEP CHIEF',
  CHIEF: 'CHIEF',
};

function rankLabel(rank: string): string {
  return RANK_LABELS[rank] ?? rank;
}

interface Props {
  bidder: BidderContext | null;
  /** Fallback id surfaced when enrichment hadn't completed yet. */
  fallbackMemberId: number | null;
  /** Whether the calling viewer is the bidder (drives the "you" badge). */
  isMe?: boolean;
  /** Compact mode: drops the pool/ordinal subline (for on-deck cards). */
  compact?: boolean;
}

export function BidderCard({ bidder, fallbackMemberId, isMe, compact }: Props) {
  if (!bidder) {
    return (
      <span
        data-testid="bidder-card-fallback"
        className={isMe ? 'font-bold text-red-700' : 'tabular-nums text-stone-900'}
      >
        {fallbackMemberId ?? '—'}
        {isMe ? ' (you)' : null}
      </span>
    );
  }

  const nameClass = isMe ? 'font-bold text-red-700' : 'font-semibold text-stone-900';

  return (
    <span
      data-testid={`bidder-card-${bidder.memberId}`}
      className="inline-flex items-baseline gap-2"
    >
      <span className={nameClass}>
        {rankLabel(bidder.rank)} {bidder.firstName} {bidder.lastName}
      </span>
      <span className="text-xs tabular-nums text-stone-500">#{bidder.employeeId}</span>
      {!compact && (
        <span className="text-xs uppercase tracking-wide text-stone-500">
          · {bidder.pool} · ord {bidder.ordinal}
        </span>
      )}
      {isMe ? <span className="text-xs font-semibold text-red-700">(you)</span> : null}
    </span>
  );
}
