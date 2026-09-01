import { z } from 'zod';

const Ref = z.string().trim().min(1).max(200);
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Wave-2 integration seam only: it neither starts nor adjudicates specialty work. */
export const SpecialtyInterruptionEnvelopeSchema = z
  .object({
    v: z.literal(1),
    requestId: z.string().uuid(),
    bidSessionId: z.string().min(1),
    policyReference: Ref,
    operation: z.enum(['request', 'decision', 'resume']),
    status: z.enum(['PENDING', 'RESOLVED', 'REJECTED']),
    provenanceReference: Ref,
  })
  .strict();
export type SpecialtyInterruptionEnvelope = z.infer<typeof SpecialtyInterruptionEnvelopeSchema>;

export const ContactDecisionEnvelopeSchema = z
  .object({
    v: z.literal(1),
    bidSessionId: z.string().min(1),
    memberId: z.number().int().positive(),
    disposition: z.enum(['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE']),
    reason: z.string().min(1).max(500),
    evidenceReference: Ref.nullable(),
    decidedAtMs: z.number().int().nonnegative(),
  })
  .strict();
export type ContactDecisionEnvelope = z.infer<typeof ContactDecisionEnvelopeSchema>;

export const FrozenPolicyReferenceSchema = z
  .object({
    v: z.literal(1),
    policyRevision: Ref,
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/i),
    capturedAtMs: z.number().int().nonnegative(),
  })
  .strict();
export type FrozenPolicyReference = z.infer<typeof FrozenPolicyReferenceSchema>;

export const AnnualCredentialEvaluationSchema = z.discriminatedUnion('status', [
  z
    .object({ status: z.literal('CONFIGURED'), evaluationOn: DateOnly, policyReference: Ref })
    .strict(),
  z
    .object({
      status: z.literal('PENDING_CONFIGURATION'),
      evaluationOn: z.null(),
      policyReference: z.null(),
    })
    .strict(),
]);
export type AnnualCredentialEvaluation = z.infer<typeof AnnualCredentialEvaluationSchema>;
export const pendingAnnualCredentialEvaluation = (): AnnualCredentialEvaluation => ({
  status: 'PENDING_CONFIGURATION',
  evaluationOn: null,
  policyReference: null,
});

/** Read-only effective-date projection. Established snapshots are explicitly excluded. */
export const BidOpportunityImpactSchema = z
  .object({
    status: z.enum(['READY', 'PENDING_CONFIGURATION']),
    effectiveOn: DateOnly.nullable(),
    currentImpact: z.enum(['NONE', 'INCLUDED', 'EXCLUDED', 'UNKNOWN']),
    futureImpact: z.enum(['NONE', 'INCLUDED', 'EXCLUDED', 'UNKNOWN']),
    establishedSnapshotsAffected: z.literal(false),
    sourceReference: Ref.nullable(),
  })
  .strict();
export type BidOpportunityImpact = z.infer<typeof BidOpportunityImpactSchema>;

export const TemporaryAssignmentPolicySchema = z
  .object({
    status: z.enum(['CONFIGURED', 'PENDING_CONFIGURATION']),
    policyReference: Ref.nullable(),
    assignments: z.array(
      z
        .object({
          kind: z.enum(['LIGHT_DUTY', 'TEMP_DUTY', 'DETAIL', 'EXECUTIVE', 'TEMP_A_DAY']),
          mode: z.enum(['OVERLAY', 'REPLACEMENT']),
          vacancyEffect: z.enum(['VACANT', 'NOT_VACANT', 'UNKNOWN']),
          bidEligibility: z.enum(['ELIGIBLE', 'INELIGIBLE', 'UNRESOLVED']),
        })
        .strict(),
    ),
  })
  .strict();
export type TemporaryAssignmentPolicy = z.infer<typeof TemporaryAssignmentPolicySchema>;
export const temporaryAssignmentBidEligibility = (
  policy: TemporaryAssignmentPolicy | null,
  kind: string,
): 'ELIGIBLE' | 'INELIGIBLE' | 'UNRESOLVED' =>
  policy?.status === 'CONFIGURED'
    ? (policy.assignments.find((entry) => entry.kind === kind)?.bidEligibility ?? 'UNRESOLVED')
    : 'UNRESOLVED';

export const QualificationBulkReviewRowSchema = z
  .object({
    rowId: z.string().min(1),
    idempotencyKey: z.string().uuid(),
    provenanceReference: Ref,
    outcome: z.enum(['ACCEPTED', 'REJECTED', 'PENDING']),
    reason: z.string().min(1).max(500).nullable(),
  })
  .strict();
export const QualificationBulkReviewSchema = z
  .object({
    v: z.literal(1),
    batchId: z.string().uuid(),
    sourceReference: Ref,
    externalWriteback: z.literal('FORBIDDEN'),
    rows: z.array(QualificationBulkReviewRowSchema).min(1),
  })
  .strict();
export type QualificationBulkReview = z.infer<typeof QualificationBulkReviewSchema>;
