import { z } from 'zod';

const STATION_RX = /^Station\s*#?\s*(.+)$/i;
const SHIFT_RX = /^(A|B|C|D)\s*Shift$/i;
const RANK_LABEL_TO_REQUIRED: Record<string, 'FF' | 'LT' | 'CPT' | 'DC'> = {
  firefighter: 'FF',
  'firefighter de': 'FF',
  'firefighter #1': 'FF',
  'firefighter #2': 'FF',
  'firefighter #3': 'FF',
  lieutenant: 'LT',
  captain: 'CPT',
  'division chief': 'DC',
};

export const PositionRowSchema = z
  .object({
    number: z.string().min(1),
    shift: z.string(),
    station: z.string(),
    division: z.string(),
    unit: z.string(),
    rank: z.string(),
    position: z.union([z.string(), z.number()]).optional(),
    assignment: z.string().optional(),
    enabled: z.string().optional(),
  })
  .passthrough()
  .transform((row, ctx) => {
    const shiftMatch = SHIFT_RX.exec(row.shift.trim());
    const shiftLetter = shiftMatch?.[1];
    if (!shiftMatch || !shiftLetter) {
      ctx.addIssue({ code: 'custom', message: `Bad shift "${row.shift}"` });
      return z.NEVER;
    }
    const shift = shiftLetter.toUpperCase() as 'A' | 'B' | 'C' | 'D';

    const stationRaw = row.station.trim();
    const station = STATION_RX.test(stationRaw)
      ? stationRaw.replace(STATION_RX, '$1').trim()
      : stationRaw;

    const rankRequired = RANK_LABEL_TO_REQUIRED[row.rank.trim().toLowerCase()];
    if (!rankRequired) {
      ctx.addIssue({ code: 'custom', message: `Unknown rank for position "${row.rank}"` });
      return z.NEVER;
    }

    return {
      id: row.number.trim(),
      shift,
      station,
      division: row.division.trim() as
        | 'Combat'
        | 'Rescue'
        | 'Prevention'
        | 'Training'
        | 'Support Services',
      unit: row.unit.trim(),
      rankRequired,
      positionName: row.rank.trim(),
      isFloating: stationRaw.toLowerCase().includes('float'),
      isVacantByDesign: false,
      isExcludedFromCount: false,
    };
  });

export type PositionRow = z.infer<typeof PositionRowSchema>;
