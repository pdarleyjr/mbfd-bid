import type { Credential, EligibilityReason, Member } from '../types.js';

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

function unavailableCredentialReason(
  credential: Credential,
  requiredName: string,
  evaluationOn: string | undefined,
): EligibilityReason | null {
  if (credential.status !== undefined && credential.status !== 'active')
    return {
      code: `CRED_${credential.status.toUpperCase()}`,
      label: `Required credential is ${credential.status}: ${requiredName}`,
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
      label: `Required credential is not effective on ${evaluationOn}: ${requiredName}`,
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
      label: `Required credential expired before ${evaluationOn}: ${requiredName}`,
      satisfied: false,
    };
  return null;
}

/** One inclusive interval/lifecycle test for minimums, alternatives and points.
 * Omitted lifecycle/date facts retain the existing legacy-evidence behavior. */
export function credentialIsActiveOn(credential: Credential, evaluationOn: string | undefined) {
  return unavailableCredentialReason(credential, credential.name, evaluationOn) === null;
}

const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** This ordering chooses an explanation, never a qualification priority.
 * Any valid matching interval wins. Prefer exact evidence, then the latest
 * effective interval; stable remaining fields make failures order independent. */
function compareCredentialEvidence(left: Credential, right: Credential, requiredName: string) {
  return (
    Number(left.name !== requiredName) - Number(right.name !== requiredName) ||
    compareText(left.name, right.name) ||
    compareText(right.effectiveOn ?? '', left.effectiveOn ?? '') ||
    compareText(right.expiresOn ?? '\uffff', left.expiresOn ?? '\uffff') ||
    compareText(left.status ?? 'active', right.status ?? 'active')
  );
}

function intervalLabel(credential: Credential): string {
  const dates = [
    ...(credential.effectiveOn ? [`effective on ${credential.effectiveOn}`] : []),
    ...(credential.expiresOn ? [`expires on ${credential.expiresOn}`] : []),
  ];
  return dates.length === 0 ? '' : ` (${dates.join(', ')})`;
}

export function requiredCredsSatisfied(
  member: Member,
  requiredCredentialNames: string[],
): EligibilityReason[] {
  const evaluationOn = member.scoringEvidence?.evaluationOn;
  return requiredCredentialNames.map((name) => {
    const matching = member.credentials
      .filter((candidate) => credentialSatisfiesMinimum(candidate.name, name))
      .sort((left, right) => compareCredentialEvidence(left, right, name));
    const credential =
      matching.find((candidate) => credentialIsActiveOn(candidate, evaluationOn)) ?? matching[0];
    if (credential === undefined)
      return { code: 'CRED_MISSING', label: `Missing required: ${name}`, satisfied: false };
    const unavailable = unavailableCredentialReason(credential, name, evaluationOn);
    if (unavailable !== null) return unavailable;
    if (credential.name !== name)
      return {
        code: 'CRED_EQUIVALENT',
        label: `Holds ${credential.name}, which satisfies the 2026 ${name} minimum${intervalLabel(credential)}`,
        satisfied: true,
      };
    return {
      code: 'CRED_OK',
      label: `Holds current required: ${name}${intervalLabel(credential)}`,
      satisfied: true,
    };
  });
}
