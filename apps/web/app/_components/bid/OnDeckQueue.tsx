/**
 * On-deck queue — shows the next 5 bidders after the active one. Renders
 * nothing when the queue is empty (Phase-2 / paused / complete) so the page
 * stays clean. Used in both admin and member views.
 */

import { BidderCard, type BidderContext } from './BidderCard';

interface Props {
  onDeck: ReadonlyArray<BidderContext>;
  /** Highlight the calling member's row when they're in the next-5 window. */
  meMemberId: number | null;
}

export function OnDeckQueue({ onDeck, meMemberId }: Props) {
  if (onDeck.length === 0) return null;
  return (
    <aside
      data-testid="on-deck-queue"
      aria-label="On-deck bidders"
      className="border-y border-border bg-background px-6 py-3"
    >
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        On deck — next {onDeck.length}
      </h2>
      <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {onDeck.map((bidder, index) => (
          <li
            key={bidder.memberId}
            data-testid={`on-deck-${index + 1}`}
            className="flex items-baseline gap-2"
          >
            <span
              aria-hidden="true"
              className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold tabular-nums text-foreground"
            >
              {index + 1}
            </span>
            <BidderCard
              bidder={bidder}
              fallbackMemberId={bidder.memberId}
              isMe={meMemberId !== null && meMemberId === bidder.memberId}
              compact
            />
          </li>
        ))}
      </ol>
    </aside>
  );
}
