import type { Member, OrderedPreferenceResult, OrderedQualificationPreference } from './types.js';

/** Qualification preference is a lexicographic vector, never a points weight.
 * Only currently held frozen credentials satisfy it; completion-credit exceptions
 * belong to their separately configured scoring items. */
export function evaluateOrderedPreference(
  member: Pick<Member, 'credentials'>,
  preference: OrderedQualificationPreference,
): OrderedPreferenceResult {
  const held = new Set(member.credentials.map((entry) => entry.name));
  return {
    sourceRef: preference.sourceRef,
    criteria: preference.criteria.map((criterion) => ({
      ...criterion,
      value:
        [criterion.credential, ...criterion.alternatives].some((name) => held.has(name)) &&
        criterion.requiresAll.every((name) => held.has(name))
          ? 1
          : 0,
    })),
  };
}

export interface OrderedPreferenceStep {
  key: 'ordered_preference';
  criterion: string;
  sourceRef: string;
  left: number;
  right: number;
  direction: 'HIGHER_FIRST';
  result: -1 | 0 | 1;
}

export function compareOrderedPreferences(
  left: OrderedPreferenceResult | undefined,
  right: OrderedPreferenceResult | undefined,
  visit?: (step: OrderedPreferenceStep) => void,
): -1 | 0 | 1 {
  if (left === undefined && right === undefined) return 0;
  if (
    !left ||
    !right ||
    left.sourceRef !== right.sourceRef ||
    left.criteria.length !== right.criteria.length
  )
    throw new Error('ORDERED_PREFERENCE_EVIDENCE_MISMATCH');
  // Validate the whole declared vector before an earlier criterion can decide.
  for (let index = 0; index < left.criteria.length; index++) {
    const a = left.criteria[index];
    const b = right.criteria[index];
    if (
      !a ||
      !b ||
      a.credential !== b.credential ||
      JSON.stringify(a.alternatives) !== JSON.stringify(b.alternatives) ||
      JSON.stringify(a.requiresAll) !== JSON.stringify(b.requiresAll) ||
      ![0, 1].includes(a.value) ||
      ![0, 1].includes(b.value)
    )
      throw new Error('ORDERED_PREFERENCE_EVIDENCE_MISMATCH');
  }
  for (let index = 0; index < left.criteria.length; index++) {
    const a = left.criteria[index];
    const b = right.criteria[index];
    if (!a || !b) throw new Error('ORDERED_PREFERENCE_EVIDENCE_MISMATCH');
    const result = a.value === b.value ? 0 : a.value > b.value ? -1 : 1;
    visit?.({
      key: 'ordered_preference',
      criterion: a.credential,
      sourceRef: left.sourceRef,
      left: a.value,
      right: b.value,
      direction: 'HIGHER_FIRST',
      result,
    });
    if (result !== 0) return result;
  }
  return 0;
}
