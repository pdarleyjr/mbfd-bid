import type { EligibilityReason, Member } from '../types.js';

const PARAMEDIC_CREDS = new Set(['Paramedic']);

export function paramedicSatisfied(member: Member): EligibilityReason {
  const has = member.credentials.some((c) => PARAMEDIC_CREDS.has(c.name));
  return has
    ? { code: 'PARAMEDIC_OK', label: 'Holds active Paramedic credential', satisfied: true }
    : {
        code: 'PARAMEDIC_REQUIRED',
        label: 'Active Paramedic certification required',
        satisfied: false,
      };
}
