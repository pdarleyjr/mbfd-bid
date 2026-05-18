import type { EligibilityReason, Member } from '../types.js';

const DE_QUALIFIED = 'Driver Engineer Qualified';
const FAO = 'Fire Apparatus Operations (FFP-1302)';
const HYDRAULICS = 'Fire Service Hydraulics (FFP1301)';
const FL_PUMP = 'Florida Pump Operator';

export function driverEngineerSatisfied(member: Member): EligibilityReason {
  const names = new Set(member.credentials.map((c) => c.name));
  const satisfied =
    names.has(DE_QUALIFIED) || (names.has(FAO) && names.has(HYDRAULICS)) || names.has(FL_PUMP);

  return satisfied
    ? { code: 'DE_OK', label: 'Driver Engineer qualification satisfied', satisfied: true }
    : {
        code: 'DE_REQUIRED',
        label:
          'Driver Engineer qualification required (DE Qualified, OR Fire Apparatus Ops + Hydraulics, OR FL Pump Operator)',
        satisfied: false,
      };
}
