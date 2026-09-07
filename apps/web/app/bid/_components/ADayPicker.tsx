// apps/web/app/bid/_components/ADayPicker.tsx
// Plan 07 Task 15: Phase 2 A-Day picker. Renders 4 group cards (A/B/C shifts)
// or 7 weekday cards (D shift), with capacity meter + officer invariant badge.
// Calls the REST submit endpoint and shows a confirmation toast.

'use client';

import { Button } from '@/components/ui/button';
import type { ADayValue } from '@mbfd/shared';
import { useCallback, useState } from 'react';
import {
  type ADayBoardState,
  aDayCandidatesForShift,
  newIdempotencyKey,
  submitADayPickViaRest,
} from '../../../lib/a-day-client';
import { ADayCapacityMeter } from './ADayCapacityMeter';
import { ADayInvariantBadge } from './ADayInvariantBadge';

interface Props {
  bidSessionId: string;
  state: ADayBoardState;
  /** Called after a successful submission so the parent can refetch state. */
  onPicked?: (aDay: ADayValue) => void;
}

export function ADayPicker({ bidSessionId, state, onPicked }: Props) {
  const [selecting, setSelecting] = useState<ADayValue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = useCallback(
    async (aDay: ADayValue) => {
      setSubmitting(true);
      setError(null);
      try {
        const result = await submitADayPickViaRest({
          v: 1,
          bidSessionId,
          aDay,
          idempotencyKey: newIdempotencyKey(),
        });
        if (result.status >= 400) {
          const body = result.body as { reasonLabel?: string; error?: string };
          setError(body.reasonLabel ?? body.error ?? `HTTP ${result.status}`);
          return;
        }
        onPicked?.(aDay);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
        setSelecting(null);
      }
    },
    [bidSessionId, onPicked],
  );

  if (state.currentPhase !== 'a_day_bid') {
    return <p className="text-muted-foreground text-sm">Phase 2 (A-Day) is not active.</p>;
  }
  if (!state.isMyTurn) {
    return (
      <p className="text-muted-foreground text-sm">Waiting for your turn to pick your A-Day.</p>
    );
  }
  if (state.shift === null) {
    return (
      <p className="text-red-700 text-sm">Unable to determine your shift — please contact admin.</p>
    );
  }

  const candidates = aDayCandidatesForShift(state.shift);
  const eligible = new Set(state.eligibleADays);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">
        Pick your A-Day ({state.shift}-shift)
      </h2>
      {error !== null && (
        <div
          role="alert"
          className="rounded border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          {error}
        </div>
      )}
      <div
        className={
          state.shift === 'D'
            ? 'grid grid-cols-2 sm:grid-cols-4 gap-3'
            : 'grid grid-cols-2 sm:grid-cols-4 gap-3'
        }
      >
        {candidates.map((aDay) => {
          const isEligible = eligible.has(aDay);
          const meterEntry =
            state.shift === 'D'
              ? state.meters.weekdays.find((w) => w.weekday === aDay)
              : state.meters.groups.find((g) => g.shift === state.shift && g.group === aDay);
          const meter = meterEntry?.meter;
          const isSelecting = selecting === aDay;
          return (
            <Button
              key={aDay}
              type="button"
              disabled={!isEligible || submitting}
              onClick={() => setSelecting(aDay)}
              className={`block text-left border rounded p-3 ${
                isEligible
                  ? 'border-border hover:border-red-700 bg-white'
                  : 'border-border bg-background text-stone-400 cursor-not-allowed'
              } ${isSelecting ? 'ring-2 ring-red-700' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-foreground">{aDay}</span>
                {meter && state.shift !== 'D' && (
                  <ADayInvariantBadge officers={meter.officers} required={meter.officersRequired} />
                )}
              </div>
              {meter && (
                <ADayCapacityMeter
                  total={meter.total}
                  max={meter.max}
                  dataTestId={`meter-${aDay}`}
                />
              )}
            </Button>
          );
        })}
      </div>
      {selecting !== null && (
        <div className="flex gap-2 items-center border-t border-border pt-3">
          <span className="text-sm text-foreground">
            Confirm pick: <strong>{selecting}</strong>
          </span>
          <Button
            type="button"
            disabled={submitting}
            onClick={() => onPick(selecting)}
            className="bg-red-700 text-white px-3 py-1 rounded text-sm hover:bg-red-800 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Confirm'}
          </Button>
          <Button
            type="button"
            onClick={() => setSelecting(null)}
            className="text-foreground underline text-sm"
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
