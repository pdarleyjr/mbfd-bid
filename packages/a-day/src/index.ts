// packages/a-day/src/index.ts
export type {
  ADayGroupId,
  Weekday,
  ADayValue,
  Shift,
  GroupCapacityConfig,
  WeekdayCapacityConfig,
  CapacityMeter,
  OfficerInvariantSnapshot,
  ADayPick,
  ADayState,
  PickRejectionCode,
  PickValidation,
  Phase2BidOrderStrategy,
  Rank,
} from './types.js';

export {
  COMBAT_GROUPS,
  WEEKDAYS,
  OFFICER_RANKS,
  DEFAULT_GROUP_CAPACITY,
  isOfficer,
  isCombatGroup,
  isWeekday,
  isValidADayForShift,
} from './groups.js';

export { computeCapacityMeter, isGroupFull, computeAllMeters } from './capacity.js';

export { projectedOfficers, validateOfficerInvariant } from './officer-invariant.js';
