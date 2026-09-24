export type {
  Credential,
  EligibilityReason,
  EligibilityResult,
  Member,
  OpsGate,
  PointsBreakdown,
  PointsItem,
  PointsPreference,
  PositionRule,
  Rank,
  RequiredCriteria,
  TieBreakKey,
  CohortDecision,
  EligibilityCohortResult,
} from './types.js';

export {
  holdsAllOps,
  OP_TECH_PAIRS,
  opCredNames,
  opsForTech,
  techCredNames,
  type OpTechPair,
} from './operations-techs.js';

export {
  compare,
  compareWithTrace,
  sortByTieBreak,
  missingBidOrdinalKeys,
  type ComparableResult,
  type TieBreakStep,
} from './tie-break.js';

export {
  evaluateEligibility,
  evaluateEligibilityWithTrace,
  type EligibilityChannels,
} from './evaluate.js';
export { configuredChannel } from './points/configured.js';
export { evaluateOrderedPreference, compareOrderedPreferences } from './ordered-preference.js';
export { evaluateEligibilityCohort } from './cohort.js';
export type { OrderedPreferenceResult, OrderedQualificationPreference } from './types.js';
