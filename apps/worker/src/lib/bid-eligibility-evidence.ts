import { eq } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import {
  credentials,
  memberCredentials,
  memberQualificationEvents,
  memberServiceEvidence,
  members,
  personnelLifecycleEvents,
} from '../db/schema.js';
import { derivePersonnelMemberAsOf } from './personnel-lifecycle.js';
import {
  deriveMemberQualificationProjection,
  normalizePersistedQualificationLifecycleEvent,
} from './qualification-lifecycle.js';
import { serviceCreditsAsOf } from './service-evidence.js';

/** Shared evidence reads for guided review and frozen session preparation. */
export async function loadBidEligibilityEvidence(db: DB) {
  const [memberRows, personnelEventRows, credentialRows, qualificationEventRows, serviceRows] =
    await Promise.all([
      db
        .select({
          id: members.id,
          employeeId: members.employeeId,
          firstName: members.firstName,
          lastName: members.lastName,
          bidCategory: members.bidCategory,
          rank: members.rank,
          rscSeniority: members.rscSeniority,
          rankSeniority: members.rankSeniority,
          isProbationary: members.isProbationary,
          employmentStatus: members.employmentStatus,
          employmentStatusEffectiveOn: members.employmentStatusEffectiveOn,
          separationType: members.separationType,
        })
        .from(members)
        .all(),
      db
        .select({
          id: personnelLifecycleEvents.id,
          memberId: personnelLifecycleEvents.memberId,
          kind: personnelLifecycleEvents.kind,
          effectiveOn: personnelLifecycleEvents.effectiveOn,
          employmentStatusAfter: personnelLifecycleEvents.employmentStatusAfter,
          rankAfter: personnelLifecycleEvents.rankAfter,
          separationType: personnelLifecycleEvents.separationType,
          beforeState: personnelLifecycleEvents.beforeState,
          createdAt: personnelLifecycleEvents.createdAt,
        })
        .from(personnelLifecycleEvents)
        .all(),
      db
        .select({
          memberId: memberCredentials.memberId,
          credentialId: memberCredentials.credentialId,
          name: credentials.name,
          startDate: memberCredentials.startDate,
          expirationDate: memberCredentials.expirationDate,
        })
        .from(memberCredentials)
        .innerJoin(credentials, eq(memberCredentials.credentialId, credentials.id))
        .all(),
      db
        .select({
          id: memberQualificationEvents.id,
          memberId: memberQualificationEvents.memberId,
          credentialId: memberQualificationEvents.credentialId,
          credentialName: credentials.name,
          specialtyCode: memberQualificationEvents.specialtyCode,
          specialtyTerminalStatus: memberQualificationEvents.specialtyTerminalStatus,
          kind: memberQualificationEvents.kind,
          effectiveOn: memberQualificationEvents.effectiveOn,
          expiresOn: memberQualificationEvents.expiresOn,
          evidenceSource: memberQualificationEvents.evidenceSource,
          evidenceReference: memberQualificationEvents.evidenceReference,
          reason: memberQualificationEvents.reason,
          actorSubject: memberQualificationEvents.actorSubject,
          idempotencyKey: memberQualificationEvents.idempotencyKey,
          beforeState: memberQualificationEvents.beforeState,
          afterState: memberQualificationEvents.afterState,
          createdAt: memberQualificationEvents.createdAt,
        })
        .from(memberQualificationEvents)
        .leftJoin(credentials, eq(memberQualificationEvents.credentialId, credentials.id))
        .all(),
      db
        .select({
          recordId: memberServiceEvidence.id,
          memberId: memberServiceEvidence.memberId,
          serviceCode: memberServiceEvidence.serviceCode,
          revision: memberServiceEvidence.revision,
          effectiveOn: memberServiceEvidence.effectiveOn,
          verifiedMonths: memberServiceEvidence.verifiedMonths,
          sourceRef: memberServiceEvidence.sourceRef,
          actorSubject: memberServiceEvidence.actorSubject,
        })
        .from(memberServiceEvidence)
        .all(),
    ]);
  return { memberRows, personnelEventRows, credentialRows, qualificationEventRows, serviceRows };
}

export function projectAnnualMemberEvidence(
  evidence: Awaited<ReturnType<typeof loadBidEligibilityEvidence>>,
  personnelOn: string,
  qualificationsOn: string,
) {
  const events = evidence.qualificationEventRows.map((row) =>
    normalizePersistedQualificationLifecycleEvent({ ...row, createdAt: row.createdAt.getTime() }),
  );
  if (events.some((event) => event === null))
    return { ok: false as const, error: 'qualification_lifecycle_data_invalid' };
  const validEvents = events.filter((event) => event !== null);
  const eventCreatedAt = new Map(validEvents.map((event) => [event.id, event.createdAt]));
  const legacy = evidence.credentialRows.map((row) => ({
    memberId: row.memberId,
    credentialId: row.credentialId,
    credentialName: row.name,
    startDate: row.startDate,
    expirationDate: row.expirationDate,
  }));
  const members = evidence.memberRows.map((member) => {
    const projected = derivePersonnelMemberAsOf(
      member,
      evidence.personnelEventRows
        .filter((e) => e.memberId === member.id)
        .map((e) => ({ ...e, createdAt: e.createdAt.getTime() })),
      personnelOn,
    );
    const qualifications = deriveMemberQualificationProjection({
      memberId: member.id,
      asOf: qualificationsOn,
      legacyCredentials: legacy,
      events: validEvents,
    });
    return {
      memberId: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      rank: projected.rank,
      employmentStatus: projected.employmentStatus,
      bidCategory: member.bidCategory,
      isProbationary: member.isProbationary,
      rscSeniority: member.rscSeniority,
      rankSeniority: member.rankSeniority,
      serviceCredits: serviceCreditsAsOf(evidence.serviceRows, member.id, personnelOn),
      certifications: qualifications.certifications.map((q) => ({
        credentialId: q.credentialId,
        name: q.credentialName,
        status: q.status,
        effectiveOn: q.effectiveOn,
        expiresOn: q.expiresOn,
        evidenceSource: q.evidenceSource,
        evidenceReference: q.evidenceReference,
        changedAt: q.eventId ? (eventCreatedAt.get(q.eventId) ?? null) : null,
      })),
      specialties: qualifications.specialties.map((q) => ({
        code: q.specialtyCode,
        status: q.status,
        effectiveOn: q.effectiveOn,
        expiresOn: q.expiresOn,
        evidenceSource: q.evidenceSource,
        evidenceReference: q.evidenceReference,
        changedAt: q.eventId ? (eventCreatedAt.get(q.eventId) ?? null) : null,
      })),
    };
  });
  return { ok: true as const, members };
}
