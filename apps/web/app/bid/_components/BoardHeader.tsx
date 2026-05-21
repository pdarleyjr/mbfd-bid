interface Props {
  currentBidderId: number | null;
  currentPhase: string;
  meMemberId: number;
}

export function BoardHeader({ currentBidderId, currentPhase, meMemberId }: Props) {
  const isMine = currentBidderId === meMemberId;
  return (
    <header data-testid="bid-board-header" className="border-b border-stone-200 px-6 py-4">
      <div className="flex items-baseline gap-3 font-display text-2xl text-stone-900">
        <span>MBFD Annual Bid</span>
        <span className="text-sm font-medium text-stone-600">Phase: {currentPhase}</span>
      </div>
      <p className="mt-2 text-sm tabular-nums text-stone-700">
        Active bidder:{' '}
        <span className={isMine ? 'font-bold text-red-700' : 'text-stone-900'}>
          {currentBidderId ?? '—'}
        </span>
        {isMine ? ' (you)' : null}
      </p>
    </header>
  );
}
