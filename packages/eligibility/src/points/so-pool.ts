import { opCredNames, techCredNames } from '../operations-techs.js';
import type { Member } from '../types.js';

export const SO_CREDENTIAL_NAMES: readonly string[] = [
  ...opCredNames(),
  ...techCredNames(),
  'Drone Operator Qualified-Part 107 sUAS',
] as const;

export function computeSoPoints(member: Member): number {
  const held = new Set(member.credentials.map((c) => c.name));
  const soSet = new Set(SO_CREDENTIAL_NAMES);
  let score = 0;
  for (const name of held) {
    if (soSet.has(name)) score++;
  }
  return score;
}
