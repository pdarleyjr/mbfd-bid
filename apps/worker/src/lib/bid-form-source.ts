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

const rankColumnSchema = z.string().trim().min(1).max(100);
const rankCellSchema = z.union([z.number().finite(), z.string().trim().max(300), z.null()]);
const rankProvenanceSchema = z
  .object({
    page: z.number().int().positive(),
    textLine: z.number().int().positive(),
    bbox: z.tuple([
      z.number().finite().nonnegative(),
      z.number().finite().nonnegative(),
      z.number().finite().nonnegative(),
      z.number().finite().nonnegative(),
    ]),
    rawText: z.string().max(2000).optional(),
  })
  .strict()
  .superRefine((location, ctx) => {
    if (location.bbox[2] < location.bbox[0] || location.bbox[3] < location.bbox[1])
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bbox'],
        message: 'Invalid source bounds',
      });
  });

/** Published lists are documentary references. Numeric cells never certify a
 * member or alter the saved execution policy, comparator or selection queue. */
export const PublishedRankListSchema = z
  .object({
    listId: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    title: z.string().trim().min(1).max(200),
    source: sourceSchema.extend({
      bytes: z.number().int().positive().optional(),
      pages: z.number().int().positive().max(100),
      generatedAt: z.array(z.string().trim().min(1).max(100)).max(100),
    }),
    columns: z.array(rankColumnSchema).min(1).max(40),
    columnLabels: z.record(rankColumnSchema, z.string().trim().min(1).max(200)),
    rows: z
      .array(
        z
          .object({
            employeeId: employeeIdSchema,
            sourceMemberName: z.string().trim().min(1).max(200),
            sourceRank: z.string().trim().min(1).max(80),
            bidOrder: z.number().int().positive().nullable(),
            values: z.record(rankColumnSchema, rankCellSchema),
            provenance: z.array(rankProvenanceSchema).min(1).max(100),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict()
  .superRefine((list, ctx) => {
    if (new Set(list.columns).size !== list.columns.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns'], message: 'Duplicate column' });
    if (new Set(list.rows.map((row) => row.employeeId)).size !== list.rows.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rows'],
        message: 'Duplicate employee ID',
      });
    const columns = new Set(list.columns);
    const labelKeys = Object.keys(list.columnLabels);
    if (labelKeys.length !== columns.size || labelKeys.some((key) => !columns.has(key)))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['columnLabels'],
        message: 'Labels must match the published columns',
      });
    for (const [index, row] of list.rows.entries()) {
      const keys = Object.keys(row.values);
      if (keys.length !== columns.size || keys.some((key) => !columns.has(key)))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', index, 'values'],
          message: 'Values must match the published columns',
        });
      if (row.provenance.some((location) => location.page > list.source.pages))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', index, 'provenance'],
          message: 'Source page exceeds document pages',
        });
    }
  });
export type PublishedRankList = z.infer<typeof PublishedRankListSchema>;
export type MemberRankReference = Omit<PublishedRankList, 'rows'> & {
  row: PublishedRankList['rows'][number];
};

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
    rankLists: z.array(PublishedRankListSchema).max(25).optional(),
  })
  .strict()
  .superRefine((archive, ctx) => {
    const lists = archive.rankLists ?? [];
    if (new Set(lists.map((list) => list.listId)).size !== lists.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rankLists'],
        message: 'Duplicate list ID',
      });
    if (lists.reduce((count, list) => count + list.rows.length, 0) > 5000)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rankLists'],
        message: 'Too many source rows',
      });
  });
export type BidFormArchive = z.infer<typeof BidFormArchiveSchema>;

export function bidFormArchiveHasIdentityConflict(archive: BidFormArchive): boolean {
  const ids = archive.forms.map((form) => form.identityResolution?.employeeId ?? form.employeeId);
  const notSubmittedIds = archive.notSubmitted.map((row) => row.employeeId);
  const references = archive.airTechReferences ?? [];
  return (
    new Set(ids).size !== ids.length ||
    new Set(notSubmittedIds).size !== notSubmittedIds.length ||
    notSubmittedIds.some((id) => ids.includes(id)) ||
    new Set(references.map((row) => row.employeeId)).size !== references.length ||
    new Set((archive.rankLists ?? []).map((list) => list.listId)).size !==
      (archive.rankLists ?? []).length ||
    (archive.rankLists ?? []).some(
      (list) => new Set(list.rows.map((row) => row.employeeId)).size !== list.rows.length,
    )
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
  /** Optional for old browser/API fixtures; fresh responses always include it. */
  rankReferences?: MemberRankReference[];
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
    rankReferences: [],
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
  base.rankReferences = (receipt.archive.rankLists ?? []).flatMap((list) => {
    const matched = list.rows.filter(
      (row) =>
        row.employeeId === identity.employeeId &&
        normalizedDocumentaryName(row.sourceMemberName) === sourceName,
    );
    const row = matched[0];
    if (matched.length !== 1 || !row) return [];
    return [
      {
        listId: list.listId,
        title: list.title,
        source: list.source,
        columns: list.columns,
        columnLabels: list.columnLabels,
        row,
      },
    ];
  });
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
