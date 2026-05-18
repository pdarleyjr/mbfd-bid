import type { EligibilityReason, Member } from '../types.js';

export function requiredCredsSatisfied(
  member: Member,
  requiredCredentialNames: string[],
): EligibilityReason[] {
  const held = new Set(member.credentials.map((c) => c.name));
  return requiredCredentialNames.map((name) => {
    const satisfied = held.has(name);
    return satisfied
      ? { code: 'CRED_OK', label: `Holds required: ${name}`, satisfied: true }
      : { code: 'CRED_MISSING', label: `Missing required: ${name}`, satisfied: false };
  });
}
