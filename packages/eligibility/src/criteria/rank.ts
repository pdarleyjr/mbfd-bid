import type { EligibilityReason, Member, Rank } from '../types.js';

const RANK_LABEL: Record<Rank, string> = {
  CHIEF: 'Fire Chief',
  DEP_CHIEF: 'Deputy Fire Chief',
  DC: 'Division Chief',
  CPT: 'Captain',
  LT: 'Lieutenant',
  FF: 'Firefighter',
};

export function rankSatisfied(member: Member, allowedRanks: Rank[]): EligibilityReason {
  if (allowedRanks.includes(member.rank)) {
    return {
      code: 'RANK_OK',
      label: `Rank ${RANK_LABEL[member.rank]} is eligible for this position`,
      satisfied: true,
    };
  }
  const required = allowedRanks.map((r) => RANK_LABEL[r]).join(' or ');
  return {
    code: 'RANK_REQUIRED',
    label: `Requires ${required}; member holds ${RANK_LABEL[member.rank]}`,
    satisfied: false,
  };
}
