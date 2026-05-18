import type { EligibilityReason, Member } from '../types.js';

export function nonProbationarySatisfied(member: Member): EligibilityReason {
  return member.isProbationary
    ? {
        code: 'PROBATIONARY_RESTRICTED',
        label: 'Position restricted to non-probationary members',
        satisfied: false,
      }
    : {
        code: 'NON_PROBATIONARY_OK',
        label: 'Member is non-probationary',
        satisfied: true,
      };
}
