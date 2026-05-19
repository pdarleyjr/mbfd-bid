// apps/web/app/bid/_components/ADayCapacityMeter.tsx
// Plan 07 Task 15: Reusable capacity meter — used inside the per-group and
// per-weekday cards in the A-Day picker.

interface Props {
  total: number;
  max: number | undefined;
  dataTestId?: string;
}

export function ADayCapacityMeter({ total, max, dataTestId }: Props) {
  if (max === undefined) {
    return (
      <div className="text-stone-700 text-sm" data-testid={dataTestId}>
        <span className="tabular-nums font-mono">{total}</span>{' '}
        <span className="text-stone-500">(no cap)</span>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((total / max) * 100));
  const full = total >= max;
  return (
    <div data-testid={dataTestId}>
      <div className="flex justify-between text-sm">
        <span className="tabular-nums font-mono text-stone-800">
          {total} / {max}
        </span>
      </div>
      <div className="h-2 bg-stone-200 rounded mt-1 overflow-hidden">
        <div
          data-testid={dataTestId ? `${dataTestId}-bar` : undefined}
          className={full ? 'h-2 bg-red-700' : 'h-2 bg-red-500'}
          style={{ width: `${pct}%`, transition: 'width 200ms ease' }}
        />
      </div>
    </div>
  );
}
