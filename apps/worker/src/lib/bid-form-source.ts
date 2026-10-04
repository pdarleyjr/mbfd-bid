import { z } from 'zod';

const sourceSchema = z
  .object({ name: z.string().trim().min(1).max(200), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const locationSchema = z
  .object({ sheet: z.string().min(1).max(100), row: z.number().int().positive() })
  .strict();
const employeeIdSchema = z.string().trim().min(1).max(80);
const identityResolutionSchema = z
  .object({
    employeeId: employeeIdSchema,
    method: z.literal('AUTHORITATIVE_DIRECTORY_CORRECTION'),
    source: sourceSchema,
    sourceLocation: z.string().min(1).max(300),
    discrepancy: z.string().min(1).max(500),
  })
  .strict();

export const SubmittedBidFormSchema = z
  .object({
    employeeId: employeeIdSchema,
    sourceName: z.string().trim().min(1).max(200),
    sourceRank: z.string().trim().min(1).max(80),
    attendingTeams: z.string().trim().max(80),
    phone1: z.string().trim().max(100).nullable(),
    phone2: z.string().trim().max(100).nullable(),
    positionPreferences: z
      .array(
        z
          .object({
            order: z.number().int().min(1).max(3),
            shift: z.string().trim().min(1).max(80),
            unit: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .max(3),
    aDayPreferences: z
      .array(
        z
          .object({
            order: z.number().int().min(1).max(4),
            sourceLabel: z.string().trim().min(1).max(100),
            shift: z.enum(['A', 'B', 'C', 'D']).nullable(),
            group: z.enum(['G1', 'G2', 'G3', 'G4']).nullable(),
          })
          .strict(),
      )
      .max(4),
    sourceLocation: locationSchema,
    identityResolution: identityResolutionSchema.optional(),
  })
  .strict();
export type SubmittedBidForm = z.infer<typeof SubmittedBidFormSchema>;

export const AirTechReferenceSchema = z
  .object({
    employeeId: employeeIdSchema,
    sourceMemberName: z.string().min(1).max(200),
    bidOrder: z.number().int().positive(),
    driverEngineerPoints: z.number().finite().nonnegative(),
    airTechPoints: z.number().finite().nonnegative(),
    carSeatPoints: z.number().finite().nonnegative(),
    dronePoints: z.number().finite().nonnegative(),
    operationsPoints: z.number().finite().nonnegative(),
    technicianPoints: z.number().finite().nonnegative(),
    totalPoints: z.number().finite().nonnegative(),
    rankSeniority: z.number().finite().nonnegative(),
    generatedAt: z.string().min(1).max(100),
    sourceName: z.string().min(1).max(200),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type AirTechReference = z.infer<typeof AirTechReferenceSchema>;

export const BidFormArchiveSchema = z
  .object({
    v: z.literal(1),
    year: z.number().int().min(2000).max(2200),
    source: sourceSchema,
    forms: z.array(SubmittedBidFormSchema).max(1000),
    notSubmitted: z
      .array(
        z
          .object({
            employeeId: employeeIdSchema,
            sourceName: z.string().min(1).max(200),
            sourceLocation: locationSchema,
          })
          .strict(),
      )
      .max(1000),
    unlinkedNotSubmitted: z
      .array(
        z
          .object({
            sourceName: z.string().min(1).max(200),
            sourceLocation: locationSchema,
            matchingCanonicalMembers: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(1000),
    airTechReferences: z.array(AirTechReferenceSchema).max(1000).optional(),
  })
  .strict();
export type BidFormArchive = z.infer<typeof BidFormArchiveSchema>;

export function bidFormArchiveHasIdentityConflict(archive: BidFormArchive): boolean {
  const ids = archive.forms.map((form) => form.identityResolution?.employeeId ?? form.employeeId);
  const notSubmittedIds = archive.notSubmitted.map((row) => row.employeeId);
  const references = archive.airTechReferences ?? [];
  return (
    new Set(ids).size !== ids.length ||
    new Set(notSubmittedIds).size !== notSubmittedIds.length ||
    notSubmittedIds.some((id) => ids.includes(id)) ||
    new Set(references.map((row) => row.employeeId)).size !== references.length
  );
}

export const PublishBidFormArchiveSchema = z
  .object({
    archive: BidFormArchiveSchema,
    expectedArchiveSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

export const BidFormReceiptSchema = z
  .object({
    archive: BidFormArchiveSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    publishedAt: z.string().datetime(),
    publishedBy: z.string().min(1).max(100),
  })
  .strict();
export type BidFormReceipt = z.infer<typeof BidFormReceiptSchema>;

export type MemberBidFormResponse = {
  year: number;
  memberId: number;
  sessionId: string | null;
  status: 'SUBMITTED' | 'NOT_SUBMITTED' | 'NOT_LISTED' | 'IDENTITY_REVIEW' | 'SOURCE_UNAVAILABLE';
  form: SubmittedBidForm | null;
  source: BidFormArchive['source'] | null;
  sourceLocation: z.infer<typeof locationSchema> | null;
  archiveSha256: string | null;
  publishedAt: string | null;
  airTechReference: AirTechReference | null;
};

export function normalizedDocumentaryName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Identity is always supplied by the current directory or selected session's
 * frozen projection. Submitted labels never confer eligibility or an award. */
export function projectMemberBidForm(
  receipt: BidFormReceipt | null,
  identity: { memberId: number; employeeId: string; firstName: string; lastName: string },
  year: number,
  sessionId: string | null,
): MemberBidFormResponse {
  const base: MemberBidFormResponse = {
    year,
    memberId: identity.memberId,
    sessionId,
    status: receipt ? 'NOT_LISTED' : 'SOURCE_UNAVAILABLE',
    form: null,
    source: receipt?.archive.source ?? null,
    sourceLocation: null,
    archiveSha256: receipt?.sha256 ?? null,
    publishedAt: receipt?.publishedAt ?? null,
    airTechReference: null,
  };
  if (!receipt) return base;
  const sourceName = normalizedDocumentaryName(identity.lastName + identity.firstName);
  const matches = receipt.archive.forms.filter(
    (form) =>
      (form.identityResolution?.employeeId ?? form.employeeId) === identity.employeeId &&
      normalizedDocumentaryName(form.sourceName) === sourceName,
  );
  const notSubmitted = receipt.archive.notSubmitted.filter(
    (row) =>
      row.employeeId === identity.employeeId &&
      normalizedDocumentaryName(row.sourceName) ===
        normalizedDocumentaryName(identity.firstName + identity.lastName),
  );
  const unresolvedSourceNames = receipt.archive.forms.some(
    (form) => normalizedDocumentaryName(form.sourceName) === sourceName,
  );
  const references = (receipt.archive.airTechReferences ?? []).filter(
    (row) =>
      row.employeeId === identity.employeeId &&
      normalizedDocumentaryName(row.sourceMemberName) === sourceName,
  );
  base.airTechReference = references.length === 1 ? (references[0] ?? null) : null;
  if (matches.length === 1 && notSubmitted.length === 0) {
    return {
      ...base,
      status: 'SUBMITTED',
      form: matches[0] ?? null,
      sourceLocation: matches[0]?.sourceLocation ?? null,
    };
  }
  if (
    matches.length > 1 ||
    (matches.length > 0 && notSubmitted.length > 0) ||
    (unresolvedSourceNames && matches.length === 0)
  ) {
    return { ...base, status: 'IDENTITY_REVIEW' };
  }
  if (notSubmitted.length === 1)
    return {
      ...base,
      status: 'NOT_SUBMITTED',
      sourceLocation: notSubmitted[0]?.sourceLocation ?? null,
    };
  if (notSubmitted.length > 1) return { ...base, status: 'IDENTITY_REVIEW' };
  return base;
}

export async function bidFormArchiveHash(archive: BidFormArchive): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(archive)),
  );
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
