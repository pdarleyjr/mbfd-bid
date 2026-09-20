import type { Member } from '../types.js';

export const MO_CREDENTIAL_NAMES: readonly string[] = [
  'Merchant Mariner Credential (MMC)',
  'IADRS Swim Evaluation',
  'Open Water Diver Certified',
  'Certified Public Safety Diver',
  'Hazardous Materials Operations',
  'Car Seat Technician',
] as const;

const MO_ALTERNATES: ReadonlyMap<string, string> = new Map([
  ['Hazmat Awareness Level', 'Hazardous Materials Operations'],
]);

export function computeMoPoints(
  member: Member,
  award?: (credential: string, reason?: string) => void,
): number {
  const held = new Set(member.credentials.map((c) => c.name));
  const alternates = award ? new Map<string, string>() : undefined;
  for (const [alternate, canonical] of MO_ALTERNATES) {
    if (held.has(alternate)) {
      if (!held.has(canonical)) alternates?.set(canonical, alternate);
      held.add(canonical);
    }
  }
  const moSet = new Set(MO_CREDENTIAL_NAMES);
  let score = 0;
  for (const name of held) {
    if (moSet.has(name)) {
      score++;
      const alternate = alternates?.get(name);
      award?.(name, alternate === undefined ? undefined : `Equivalent qualification: ${alternate}`);
    }
  }
  return score;
}
