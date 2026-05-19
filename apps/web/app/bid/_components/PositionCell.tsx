interface Props {
  positionId: string;
  fill: { memberId: number; ordinal: number; bidId: string } | null;
}

export function PositionCell({ positionId, fill }: Props) {
  const state = fill ? 'filled' : 'eligible-open';
  return (
    <div
      data-testid={`position-cell-${positionId}`}
      data-state={state}
      className="rounded border border-stone-200 bg-white p-3 text-sm tabular-nums"
    >
      <div className="font-mono text-xs text-stone-500">{positionId}</div>
      <div className="mt-1 text-stone-900">
        {fill ? `Filled by member ${fill.memberId}` : 'Open'}
      </div>
    </div>
  );
}
