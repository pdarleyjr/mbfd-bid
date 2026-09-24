import type { EligibilityReason, Member } from '../types.js';

const APPROVED_MINIMUM_EQUIVALENCIES: Readonly<Record<string, readonly string[]>> = {
  'Hazardous Materials Awareness': ['Hazardous Materials Operations'],
  'HazMat Awareness': ['Hazardous Materials Operations'],
  'Hazmat Awareness Level': ['Hazardous Materials Operations'],
};

export function credentialSatisfiesMinimum(heldName: string, requiredName: string): boolean {
  return (
    heldName === requiredName ||
    (APPROVED_MINIMUM_EQUIVALENCIES[requiredName] ?? []).includes(heldName)
  );
}

export function requiredCredsSatisfied(
  member: Member,
  requiredCredentialNames: string[],
): EligibilityReason[] {
  const evaluationOn = member.scoringEvidence?.evaluationOn;
  return requiredCredentialNames.map((name) => {
    const credential = member.credentials.find((candidate) =>
      credentialSatisfiesMinimum(candidate.name, name),
    );
    if (credential === undefined)
      return { code: 'CRED_MISSING', label: `Missing required: ${name}`, satisfied: false };
    if (credential.status !== undefined && credential.status !== 'active')
      return {
        code: `CRED_${credential.status.toUpperCase()}`,
        label: `Required credential is ${credential.status}: ${name}`,
        satisfied: false,
      };
    if (
      evaluationOn !== undefined &&
      credential.effectiveOn !== undefined &&
      credential.effectiveOn !== null &&
      credential.effectiveOn > evaluationOn
    )
      return {
        code: 'CRED_NOT_YET_EFFECTIVE',
        label: `Required credential is not effective on ${evaluationOn}: ${name}`,
        satisfied: false,
      };
    if (
      evaluationOn !== undefined &&
      credential.expiresOn !== undefined &&
      credential.expiresOn !== null &&
      credential.expiresOn < evaluationOn
    )
      return {
        code: 'CRED_EXPIRED',
        label: `Required credential expired before ${evaluationOn}: ${name}`,
        satisfied: false,
      };
    if (credential.name !== name)
      return {
        code: 'CRED_EQUIVALENT',
        label: `Holds ${credential.name}, which satisfies the 2026 ${name} minimum`,
        satisfied: true,
      };
    return { code: 'CRED_OK', label: `Holds current required: ${name}`, satisfied: true };
  });
}
