'use client';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ALL_SHIFTS, SHIFT_LABEL, type Shift } from './types';

interface Props {
  selected: Shift;
  onSelect: (shift: Shift) => void;
  /** Optional per-shift counts shown after the label, e.g. "A Shift · 74". */
  counts?: Partial<Record<Shift, number>> | undefined;
}

export function ShiftTabs({ selected, onSelect, counts }: Props) {
  return (
    <Tabs className="min-w-0" value={selected} onValueChange={(value) => onSelect(value as Shift)}>
      <TabsList
        activateOnFocus={false}
        aria-label="Shift selector"
        data-testid="shift-tabs"
        className="flex items-stretch gap-1 overflow-x-auto border-b border-border bg-white px-2 py-2"
      >
        {ALL_SHIFTS.map((shift) => {
          const active = shift === selected;
          const count = counts?.[shift];
          return (
            <TabsTrigger
              key={shift}
              value={shift}
              id={`shift-tab-${shift}`}
              aria-controls={`shift-panel-${shift}`}
              data-testid={`shift-tab-${shift}`}
              className={[
                'min-h-[44px] min-w-24 shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-fast ease-out-quart',
                active
                  ? shift === 'A'
                    ? 'data-[active]:bg-shift-a'
                    : shift === 'B'
                      ? 'data-[active]:bg-shift-b'
                      : shift === 'C'
                        ? 'data-[active]:bg-shift-c'
                        : 'data-[active]:bg-info'
                  : 'bg-muted text-foreground hover:bg-accent',
              ].join(' ')}
            >
              <span>{SHIFT_LABEL[shift]}</span>
              {typeof count === 'number' ? (
                <span
                  className={[
                    'ml-2 rounded-full px-2 py-0.5 text-xs',
                    active ? 'bg-black/10 text-white' : 'bg-muted text-muted-foreground',
                  ].join(' ')}
                >
                  {count}
                </span>
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
