import { Badge } from '@/components/ui/badge';
import { cva } from 'class-variance-authority';

/** Shared visual identity. Never feeds eligibility, staffing or grouping decisions. */
export const rosterTone = cva('', {
  variants: {
    tone: {
      A: 'bg-shift-a-surface text-shift-a border-shift-a/25',
      B: 'bg-shift-b-surface text-shift-b border-shift-b/25',
      C: 'bg-shift-c-surface text-shift-c border-shift-c/25',
      D: 'bg-shift-d-surface text-shift-d border-shift-d/25',
      engine: 'bg-unit-engine-surface text-unit-engine border-unit-engine/25',
      ladder: 'bg-unit-ladder-surface text-unit-ladder border-unit-ladder/25',
      rescue: 'bg-unit-rescue-surface text-unit-rescue border-unit-rescue/25',
      float: 'bg-unit-float-surface text-unit-float border-unit-float/25',
      marine: 'bg-unit-marine-surface text-unit-marine border-unit-marine/25',
      command: 'bg-unit-command-surface text-unit-command border-unit-command/25',
      neutral: 'bg-muted text-muted-foreground border-border',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function shiftTone(shift: string | null) {
  return shift === 'A' || shift === 'B' || shift === 'C' || shift === 'D' ? shift : 'neutral';
}

/** Label-based presentation fallback for historical sources without apparatus IDs. */
export function unitTone(unit: string | null) {
  const label = unit?.trim() ?? '';
  if (/^(?:(?:Combat|Rescue)\s+)?Float\b/i.test(label)) return 'float';
  if (/^(?:Engine\b|E\s*\d)/i.test(label)) return 'engine';
  if (/^(?:Ladder\b|L\s*\d)/i.test(label)) return 'ladder';
  if (/^(?:Rescue\b|R\s*\d)/i.test(label)) return 'rescue';
  if (/^(?:Marine|Fire\s*Boat|Boat)\b/i.test(label)) return 'marine';
  if (/^(?:Division Chief|Captain|Cpt|Command)\b/i.test(label)) return 'command';
  return 'neutral';
}

export function ShiftBadge({ shift }: { shift: string | null }) {
  return (
    <Badge className={rosterTone({ tone: shiftTone(shift) })}>
      {shift === 'D' ? 'D / Days' : shift ? `${shift} Shift` : 'Shift not mapped'}
    </Badge>
  );
}

export function UnitBadge({ unit }: { unit: string | null }) {
  return (
    <Badge className={rosterTone({ tone: unitTone(unit) })}>{unit || 'Unit not mapped'}</Badge>
  );
}
