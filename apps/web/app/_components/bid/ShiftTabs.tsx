'use client';
import { ALL_SHIFTS, SHIFT_LABEL, type Shift } from './types';

interface Props {
  selected: Shift;
  onSelect: (shift: Shift) => void;
  /** Optional per-shift counts shown after the label, e.g. "A Shift · 74". */
  counts?: Partial<Record<Shift, number>> | undefined;
}

export function ShiftTabs({ selected, onSelect, counts }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Shift selector"
      data-testid="shift-tabs"
      className="flex items-stretch gap-1 overflow-x-auto border-b border-stone-200 bg-white px-2 py-2"
    >
      {ALL_SHIFTS.map((shift) => {
        const active = shift === selected;
        const count = counts?.[shift];
        return (
          <button
            key={shift}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`shift-panel-${shift}`}
            data-testid={`shift-tab-${shift}`}
            onClick={() => onSelect(shift)}
            className={[
              'min-h-[44px] rounded-md px-4 py-2 text-sm font-semibold transition-colors duration-fast ease-out-quart',
              active ? 'bg-red-700 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200',
            ].join(' ')}
          >
            <span>{SHIFT_LABEL[shift]}</span>
            {typeof count === 'number' ? (
              <span
                className={[
                  'ml-2 rounded-full px-2 py-0.5 text-xs',
                  active ? 'bg-red-900/30 text-white' : 'bg-stone-200 text-stone-600',
                ].join(' ')}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
