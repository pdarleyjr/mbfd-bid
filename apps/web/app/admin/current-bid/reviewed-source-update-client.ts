'use client';

import { BidDefinitionContentSchema, BidEvidenceFreezeSchema } from '@mbfd/shared';
import { z } from 'zod';

const identity = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const imports = BidEvidenceFreezeSchema.shape.sourceImports;
const counts = z
  .object({
    members: z.number().int().nonnegative(),
    approvedQualificationEvents: z.number().int().nonnegative(),
    pendingQualificationHolds: z.number().int().nonnegative(),
  })
  .strict();
const eligibilityDates = z
  .object({
    credentialEvaluationOn: day,
    personnelEvaluationOn: day,
  })
  .strict();

export const ReviewedUpdateExpectedSchema = z
  .object({
    versionId: identity,
    revision: z.number().int().positive(),
    sha256: hash,
    sourceToken: hash,
    originalFreezeId: identity,
  })
  .strict();
export const ReviewedUpdatePreviewSchema = z
  .object({
    ok: z.literal(true),
    ready: z.boolean(),
    blockers: z.array(z.string().min(1)),
    expected: ReviewedUpdateExpectedSchema,
    original: z
      .object({
        freezeId: identity,
        evaluationSha256: hash,
        personnelSha256: hash,
        credentialSha256: hash,
      })
      .strict(),
    eligibilityDates,
    counts,
    sourceImports: imports,
    capturedAt: instant,
  })
  .strict()
  .refine(
    (value) =>
      value.ready === (value.blockers.length === 0) &&
      value.expected.originalFreezeId === value.original.freezeId,
    'The reviewed update preview is inconsistent.',
  );

export const ReviewedUpdateReceiptSchema = z
  .object({
    freezeId: identity,
    evidenceCutoffAt: z.literal('2026-09-30T17:00:00-04:00'),
    capturedAt: instant,
    sourceVersionId: identity,
    sourceVersionSha256: hash,
    evaluationSha256: hash,
    personnelSha256: hash,
    credentialSha256: hash,
    sourceImports: imports,
    counts,
    eligibilityDates,
    reason: z.string().trim().min(4).max(1000),
    actorSubject: z.string().min(1),
    freezePin: BidEvidenceFreezeSchema.refine(
      (pin) => pin.reviewedUpdate !== undefined,
      'A reviewed update receipt must contain its server provenance.',
    ),
    sourceDecisions: BidDefinitionContentSchema.shape.sourceDecisions,
  })
  .strict()
  .superRefine((value, ctx) => {
    const pin = value.freezePin;
    if (
      pin.freezeId !== value.freezeId ||
      pin.sourceVersionId !== value.sourceVersionId ||
      pin.sourceVersionSha256 !== value.sourceVersionSha256 ||
      pin.evaluationSha256 !== value.evaluationSha256 ||
      pin.personnelSnapshot.sha256 !== value.personnelSha256 ||
      pin.credentialSnapshot.sha256 !== value.credentialSha256 ||
      pin.evidenceCutoffAt !== value.evidenceCutoffAt ||
      pin.personnelSnapshot.capturedAt !== value.capturedAt ||
      pin.credentialSnapshot.capturedAt !== value.capturedAt ||
      JSON.stringify(pin.sourceImports) !== JSON.stringify(value.sourceImports)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The captured source receipt is inconsistent.',
      });
  });
export const ReviewedUpdateResultSchema = z
  .object({
    ok: z.literal(true),
    replayed: z.boolean(),
    update: ReviewedUpdateReceiptSchema,
  })
  .strict();
export const ReviewedUpdateReadbackSchema = z
  .object({
    ok: z.literal(true),
    update: ReviewedUpdateReceiptSchema,
  })
  .strict();
export const ReviewedUpdatePendingSchema = z
  .object({
    v: z.literal(1),
    actorScope: identity,
    year: z.literal(2026),
    key: z.string().uuid(),
    request: z
      .object({
        expected: ReviewedUpdateExpectedSchema,
        reason: z.string().trim().min(4).max(1000),
      })
      .strict(),
    receipt: ReviewedUpdateReceiptSchema.optional(),
  })
  .strict()
  .refine(
    (value) => !value.receipt || reviewedReceiptMatchesRequest(value.receipt, value.request),
    'The retained receipt does not match its reviewed source request.',
  );
export type ReviewedUpdatePreview = z.infer<typeof ReviewedUpdatePreviewSchema>;
export type ReviewedUpdateReceipt = z.infer<typeof ReviewedUpdateReceiptSchema>;
export type ReviewedUpdatePending = z.infer<typeof ReviewedUpdatePendingSchema>;

export function reviewedReceiptMatchesRequest(
  receipt: ReviewedUpdateReceipt,
  request: {
    expected: z.infer<typeof ReviewedUpdateExpectedSchema>;
    reason: string;
  },
) {
  const provenance = receipt.freezePin.reviewedUpdate;
  if (!provenance) return false;
  return (
    receipt.sourceVersionId === request.expected.versionId &&
    receipt.sourceVersionSha256 === request.expected.sha256 &&
    receipt.reason === request.reason &&
    provenance.sourceToken === request.expected.sourceToken &&
    provenance.originalFreezeId === request.expected.originalFreezeId
  );
}

export const reviewedUpdateMessage = (code: string) =>
  ({
    latest_2026_source_version_required:
      'The reviewed October 1 source revision must be linked before capture.',
    latest_2026_credential_revision_review_required:
      'Finish reviewing the Version 5 credential import, including its exceptions.',
    latest_2026_personnel_corrections_required:
      'The required personnel corrections still need review.',
    evidence_update_source_changed:
      'The saved Bid or Department evidence changed. Review the latest source again.',
    evidence_update_real_active:
      'A Real bid is active. The source cannot be updated during that bid.',
    evidence_update_writeback_enabled:
      'Staffing writeback must be disabled before this source update.',
    step_up_required: 'Refresh operator sign-in, then retry the retained request.',
  })[code] ?? code.replaceAll('_', ' ');
