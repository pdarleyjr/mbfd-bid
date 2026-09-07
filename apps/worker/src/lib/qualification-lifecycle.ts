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
  'SPECIALTY_EXPIRED',
  'SPECIALTY_REVOKED',
  'SPECIALTY_REMOVED',
] as const;

export type QualificationLifecycleKind = (typeof QUALIFICATION_LIFECYCLE_KINDS)[number];
export type QualificationStatus = 'active' | 'expired' | 'revoked' | 'removed';
export type SpecialtyTerminalStatus = 'EXPIRED' | 'REVOKED' | 'REMOVED';

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

/**
 * Raw D1 row shape used at the snapshot boundary. Specialty terminal events
 * retain `SPECIALTY_QUALIFIED` in the immutable legacy `kind` column and use
 * the additive discriminator to express their logical terminal state.
 */
export interface PersistedQualificationLifecycleEvent
  extends Omit<QualificationLifecycleEvent, 'kind'> {
  kind: string;
  specialtyTerminalStatus: string | null;
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
  status: Exclude<QualificationStatus, 'removed'>;
  effectiveOn: string | null;
  expiresOn: string | null;
  evidenceSource: string | null;
  evidenceReference: string | null;
  eventId: string | null;
  origin: 'lifecycle_evidence' | 'legacy_projection';
}

export interface SpecialtyQualification {
  specialtyCode: string;
  status: QualificationStatus;
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
 * Converts an immutable D1 evidence row into the logical lifecycle event used
 * by projections. A malformed terminal discriminator is rejected rather than
 * silently interpreted as a new specialty qualification.
 */
export function normalizePersistedQualificationLifecycleEvent(
  input: PersistedQualificationLifecycleEvent,
): QualificationLifecycleEvent | null {
  if (input.specialtyTerminalStatus === null) {
    // The pre-0033 ledger could not persist direct specialty terminal kinds.
    // Seeing one without its companion discriminator means a corrupt/imported
    // row, never a safe qualification fact.
    if (
      input.kind === 'SPECIALTY_EXPIRED' ||
      input.kind === 'SPECIALTY_REVOKED' ||
      input.kind === 'SPECIALTY_REMOVED' ||
      !isQualificationLifecycleKind(input.kind)
    ) {
      return null;
    }
    return {
      id: input.id,
      memberId: input.memberId,
      credentialId: input.credentialId,
      credentialName: input.credentialName,
      specialtyCode: input.specialtyCode,
      kind: input.kind,
      effectiveOn: input.effectiveOn,
      expiresOn: input.expiresOn,
      evidenceSource: input.evidenceSource,
      evidenceReference: input.evidenceReference,
      reason: input.reason,
      actorSubject: input.actorSubject,
      idempotencyKey: input.idempotencyKey,
      beforeState: input.beforeState,
      afterState: input.afterState,
      createdAt: input.createdAt,
    };
  }

  if (
    !isSpecialtyTerminalStatus(input.specialtyTerminalStatus) ||
    input.kind !== 'SPECIALTY_QUALIFIED' ||
    input.credentialId !== null ||
    !isValidSpecialtyCode(input.specialtyCode) ||
    !isQualificationCalendarDate(input.effectiveOn) ||
    (input.expiresOn !== null && !isQualificationCalendarDate(input.expiresOn)) ||
    (input.expiresOn !== null && input.expiresOn < input.effectiveOn) ||
    (input.specialtyTerminalStatus === 'EXPIRED' && input.expiresOn !== input.effectiveOn) ||
    (input.specialtyTerminalStatus !== 'EXPIRED' && input.expiresOn !== null)
  ) {
    return null;
  }

  return {
    id: input.id,
    memberId: input.memberId,
    credentialId: null,
    credentialName: input.credentialName,
    specialtyCode: input.specialtyCode,
    kind:
      input.specialtyTerminalStatus === 'EXPIRED'
        ? 'SPECIALTY_EXPIRED'
        : input.specialtyTerminalStatus === 'REVOKED'
          ? 'SPECIALTY_REVOKED'
          : 'SPECIALTY_REMOVED',
    effectiveOn: input.effectiveOn,
    expiresOn: input.expiresOn,
    evidenceSource: input.evidenceSource,
    evidenceReference: input.evidenceReference,
    reason: input.reason,
    actorSubject: input.actorSubject,
    idempotencyKey: input.idempotencyKey,
    beforeState: input.beforeState,
    afterState: input.afterState,
    createdAt: input.createdAt,
  };
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
    if (isSpecialtyLifecycleKind(event.kind)) {
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
 * The V3 Bid snapshot retains credential display names separately from
 * specialty evidence. No specialty code is guessed as a credential.
 */
export function completedCredentialNamesAsOf(input: {
  memberId: number;
  asOf: string;
  legacyCredentials: LegacyCredentialBaseline[];
  events: QualificationLifecycleEvent[];
}): string[] {
  return deriveMemberQualificationProjection(input)
    .certifications.filter((c) => c.status === 'active' || c.status === 'expired')
    .map((c) => c.credentialName)
    .filter((name): name is string => name !== null)
    .sort();
}

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

/**
 * Projects specialty evidence independently of credentials. The resulting
 * state includes active and terminal facts so a frozen V3 policy can preserve
 * why a code was ineligible at its configured evaluation date without copying
 * raw source evidence into the session snapshot.
 */
export function specialtyQualificationsByMemberAsOf(input: {
  asOf: string;
  events: readonly QualificationLifecycleEvent[];
}): Map<number, SpecialtyQualification[]> {
  const memberIds = new Set<number>(input.events.map((event) => event.memberId));
  const output = new Map<number, SpecialtyQualification[]>();
  for (const memberId of memberIds) {
    output.set(
      memberId,
      deriveMemberQualificationProjection({
        memberId,
        asOf: input.asOf,
        legacyCredentials: [],
        events: input.events,
      }).specialties,
    );
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

function isSpecialtyLifecycleKind(kind: QualificationLifecycleKind): boolean {
  return kind.startsWith('SPECIALTY_');
}

function isSpecialtyTerminalStatus(value: unknown): value is SpecialtyTerminalStatus {
  return value === 'EXPIRED' || value === 'REVOKED' || value === 'REMOVED';
}

function isValidSpecialtyCode(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length >= 1 && value.length <= 128 && value === value.trim()
  );
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
  const status: QualificationStatus =
    event.kind === 'SPECIALTY_EXPIRED'
      ? 'expired'
      : event.kind === 'SPECIALTY_REVOKED'
        ? 'revoked'
        : event.kind === 'SPECIALTY_REMOVED'
          ? 'removed'
          : event.expiresOn !== null && event.expiresOn < asOf
            ? 'expired'
            : 'active';
  return {
    specialtyCode: event.specialtyCode as string,
    status,
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
