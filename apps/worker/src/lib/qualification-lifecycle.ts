/**
 * Effective-dated credential and specialty evidence projection.
 *
 * `member_credentials` predates the lifecycle ledger. It remains a
 * compatibility baseline only; lifecycle evidence overrides it as of the
 * requested date. New evidence is never inferred from that baseline.
 */

export const QUALIFICATION_LIFECYCLE_KINDS = [
  'CERTIFICATION_GAINED',
  'CERTIFICATION_EXPIRED',
  'CERTIFICATION_REVOKED',
  'SPECIALTY_QUALIFIED',
] as const;

export type QualificationLifecycleKind = (typeof QUALIFICATION_LIFECYCLE_KINDS)[number];
export type QualificationStatus = 'active' | 'expired' | 'revoked';

export interface QualificationLifecycleEvent {
  id: string;
  memberId: number;
  credentialId: number | null;
  credentialName: string | null;
  specialtyCode: string | null;
  kind: QualificationLifecycleKind;
  effectiveOn: string;
  expiresOn: string | null;
  evidenceSource: string;
  evidenceReference: string | null;
  reason: string;
  actorSubject: string;
  idempotencyKey: string;
  beforeState: string;
  afterState: string;
  createdAt: number;
}

export interface LegacyCredentialBaseline {
  memberId: number;
  credentialId: number;
  credentialName: string;
  /** The legacy projection remains valid only on/after this date when present. */
  startDate: string | null;
  /** Legacy credential expiry is inclusive of its calendar date. */
  expirationDate: string | null;
}

export interface CertificationQualification {
  credentialId: number;
  credentialName: string | null;
  status: QualificationStatus;
  effectiveOn: string | null;
  expiresOn: string | null;
  evidenceSource: string | null;
  evidenceReference: string | null;
  eventId: string | null;
  origin: 'lifecycle_evidence' | 'legacy_projection';
}

export interface SpecialtyQualification {
  specialtyCode: string;
  status: Exclude<QualificationStatus, 'revoked'>;
  effectiveOn: string;
  expiresOn: string | null;
  evidenceSource: string;
  evidenceReference: string | null;
  eventId: string;
}

export interface MemberQualificationProjection {
  certifications: CertificationQualification[];
  specialties: SpecialtyQualification[];
}

export function isQualificationLifecycleKind(value: unknown): value is QualificationLifecycleKind {
  return (
    typeof value === 'string' &&
    (QUALIFICATION_LIFECYCLE_KINDS as readonly string[]).includes(value)
  );
}

export function isQualificationCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Resolves the evidence state that an operator or policy snapshot could have
 * known on `asOf`. Later evidence must not rewrite that historical view.
 */
export function deriveMemberQualificationProjection(input: {
  memberId: number;
  asOf: string;
  legacyCredentials: readonly LegacyCredentialBaseline[];
  events: readonly QualificationLifecycleEvent[];
}): MemberQualificationProjection {
  const certifications = new Map<number, CertificationQualification>();
  for (const baseline of input.legacyCredentials) {
    if (baseline.memberId !== input.memberId) continue;
    const qualification = qualificationFromLegacyBaseline(baseline, input.asOf);
    if (qualification !== null) certifications.set(baseline.credentialId, qualification);
  }

  const specialties = new Map<string, SpecialtyQualification>();
  for (const event of sortApplicableEvents(input.events, input.memberId, input.asOf)) {
    if (event.kind === 'SPECIALTY_QUALIFIED') {
      if (event.specialtyCode === null) continue;
      specialties.set(event.specialtyCode, specialtyFromEvent(event, input.asOf));
      continue;
    }
    if (event.credentialId === null) continue;
    const current = certifications.get(event.credentialId);
    if (event.kind === 'CERTIFICATION_GAINED') {
      certifications.set(event.credentialId, certificationFromEvent(event, input.asOf));
      continue;
    }
    const credentialName = event.credentialName ?? current?.credentialName ?? null;
    certifications.set(event.credentialId, {
      credentialId: event.credentialId,
      credentialName,
      status: event.kind === 'CERTIFICATION_REVOKED' ? 'revoked' : 'expired',
      effectiveOn: event.effectiveOn,
      expiresOn: event.expiresOn,
      evidenceSource: event.evidenceSource,
      evidenceReference: event.evidenceReference,
      eventId: event.id,
      origin: 'lifecycle_evidence',
    });
  }

  for (const [credentialId, qualification] of certifications.entries()) {
    if (
      qualification.status === 'active' &&
      qualification.expiresOn !== null &&
      qualification.expiresOn < input.asOf
    ) {
      certifications.set(credentialId, { ...qualification, status: 'expired' });
    }
  }

  for (const [specialtyCode, qualification] of specialties.entries()) {
    if (
      qualification.status === 'active' &&
      qualification.expiresOn !== null &&
      qualification.expiresOn < input.asOf
    ) {
      specialties.set(specialtyCode, { ...qualification, status: 'expired' });
    }
  }

  return {
    certifications: [...certifications.values()].sort(compareCertification),
    specialties: [...specialties.values()].sort((left, right) =>
      left.specialtyCode.localeCompare(right.specialtyCode),
    ),
  };
}

/**
 * The V3 Bid snapshot retains only credential display names. This adapter
 * intentionally excludes specialty evidence until a rule-book criterion is
 * explicitly modeled for it; no specialty name is guessed as a credential.
 */
export function activeCredentialNamesByMemberAsOf(input: {
  asOf: string;
  legacyCredentials: readonly LegacyCredentialBaseline[];
  events: readonly QualificationLifecycleEvent[];
}): Map<number, string[]> {
  const memberIds = new Set<number>([
    ...input.legacyCredentials.map((credential) => credential.memberId),
    ...input.events.map((event) => event.memberId),
  ]);
  const output = new Map<number, string[]>();
  for (const memberId of memberIds) {
    const projection = deriveMemberQualificationProjection({
      memberId,
      asOf: input.asOf,
      legacyCredentials: input.legacyCredentials,
      events: input.events,
    });
    const names = projection.certifications
      .filter(
        (qualification) =>
          qualification.status === 'active' && qualification.credentialName !== null,
      )
      .map((qualification) => qualification.credentialName as string)
      .sort((left, right) => left.localeCompare(right));
    output.set(memberId, [...new Set(names)]);
  }
  return output;
}

function sortApplicableEvents(
  events: readonly QualificationLifecycleEvent[],
  memberId: number,
  asOf: string,
): QualificationLifecycleEvent[] {
  return events
    .filter((event) => event.memberId === memberId && event.effectiveOn <= asOf)
    .filter((event) => isQualificationLifecycleKind(event.kind))
    .slice()
    .sort(
      (left, right) =>
        left.effectiveOn.localeCompare(right.effectiveOn) ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id),
    );
}

function certificationFromEvent(
  event: QualificationLifecycleEvent,
  asOf: string,
): CertificationQualification {
  return {
    credentialId: event.credentialId as number,
    credentialName: event.credentialName,
    status: event.expiresOn !== null && event.expiresOn < asOf ? 'expired' : 'active',
    effectiveOn: event.effectiveOn,
    expiresOn: event.expiresOn,
    evidenceSource: event.evidenceSource,
    evidenceReference: event.evidenceReference,
    eventId: event.id,
    origin: 'lifecycle_evidence',
  };
}

function qualificationFromLegacyBaseline(
  baseline: LegacyCredentialBaseline,
  asOf: string,
): CertificationQualification | null {
  // Legacy date columns predate the immutable evidence ledger. They are still
  // authoritative bounds when populated: accepting malformed or future dated
  // legacy data would make an invalid credential eligible at a Bid freeze.
  if (
    (baseline.startDate !== null && !isQualificationCalendarDate(baseline.startDate)) ||
    (baseline.expirationDate !== null && !isQualificationCalendarDate(baseline.expirationDate)) ||
    (baseline.startDate !== null &&
      baseline.expirationDate !== null &&
      baseline.expirationDate < baseline.startDate) ||
    (baseline.startDate !== null && baseline.startDate > asOf)
  ) {
    return null;
  }
  return {
    credentialId: baseline.credentialId,
    credentialName: baseline.credentialName,
    status:
      baseline.expirationDate !== null && baseline.expirationDate < asOf ? 'expired' : 'active',
    effectiveOn: baseline.startDate,
    expiresOn: baseline.expirationDate,
    evidenceSource: null,
    evidenceReference: null,
    eventId: null,
    origin: 'legacy_projection',
  };
}

function specialtyFromEvent(
  event: QualificationLifecycleEvent,
  asOf: string,
): SpecialtyQualification {
  return {
    specialtyCode: event.specialtyCode as string,
    status: event.expiresOn !== null && event.expiresOn < asOf ? 'expired' : 'active',
    effectiveOn: event.effectiveOn,
    expiresOn: event.expiresOn,
    evidenceSource: event.evidenceSource,
    evidenceReference: event.evidenceReference,
    eventId: event.id,
  };
}

function compareCertification(
  left: CertificationQualification,
  right: CertificationQualification,
): number {
  return (
    (left.credentialName ?? '').localeCompare(right.credentialName ?? '') ||
    left.credentialId - right.credentialId
  );
}
