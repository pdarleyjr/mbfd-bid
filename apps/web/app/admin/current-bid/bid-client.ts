'use client';

import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { BidDefinitionContentSchema, BidImpactResponseSchema } from '@mbfd/shared';
import { z } from 'zod';

const identity = z.string().min(1).max(200);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
export const BidExpectedSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('legacy'), sourceToken: digest }).strict(),
  z
    .object({
      kind: z.literal('version'),
      versionId: identity,
      revision: z.number().int().positive(),
      sha256: digest,
    })
    .strict(),
]);
export const BidVersionSchema = z
  .object({
    id: identity,
    versionNumber: z.number().int().positive(),
    contentSha256: digest,
    createdAtMs: z.number().int(),
    actorSubject: z.string(),
    reason: z.string(),
    predecessorId: identity.nullable(),
    restoredFromId: identity.nullable(),
  })
  .strict();
const ids = z.array(z.string());
const summary = {
  coverage: z
    .object({
      valid: z.boolean(),
      ruleCount: z.number().int().nonnegative(),
      missingBiddablePositionIds: ids,
      invalidPositionIds: ids,
      duplicatePositionIds: ids,
      nonBiddablePositionIds: ids,
      unexpectedPositionIds: ids,
    })
    .strict(),
  stats: z
    .object({
      opportunityCount: z.number().int().nonnegative(),
      ruleCount: z.number().int().nonnegative(),
      biddableCount: z.number().int().nonnegative(),
      administrativelyAssignedCount: z.number().int().nonnegative(),
      reservedCount: z.number().int().nonnegative(),
      excludedCount: z.number().int().nonnegative(),
      missingRuleCount: z.number().int().nonnegative(),
    })
    .strict(),
};
export const CurrentBidSchema = z
  .object({
    bidYear: z.number().int(),
    state: z.enum(['VERSIONED', 'LEGACY_UNADOPTED']),
    version: BidVersionSchema.nullable(),
    expected: BidExpectedSchema,
    content: BidDefinitionContentSchema,
    ...summary,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.content.bidYear !== value.bidYear ||
      (value.state === 'VERSIONED'
        ? !value.version ||
          value.expected.kind !== 'version' ||
          value.version.id !== value.expected.versionId ||
          value.version.versionNumber !== value.expected.revision ||
          value.version.contentSha256 !== value.expected.sha256
        : value.version !== null || value.expected.kind !== 'legacy')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The returned Bid identity is inconsistent.',
      });
    }
  });
export const HistoricalBidSchema = z
  .object({
    bidYear: z.number().int(),
    version: BidVersionSchema,
    content: BidDefinitionContentSchema,
    ...summary,
  })
  .strict()
  .refine(
    (value) => value.bidYear === value.content.bidYear,
    'The historical Bid belongs to another year.',
  );
export const BidVersionsSchema = z
  .object({
    bidYear: z.number().int(),
    versions: z.array(BidVersionSchema),
    nextBeforeVersionNumber: z.number().int().positive().nullable(),
  })
  .strict();
export const BidSaveResultSchema = z
  .object({
    changed: z.boolean(),
    replayed: z.boolean(),
    versionId: identity,
    versionNumber: z.number().int().positive(),
    contentSha256: digest,
    predecessorId: identity.nullable(),
    restoredFromId: identity.nullable(),
  })
  .strict();
const keyedDiff = z.object({ addedIds: ids, removedIds: ids, changedIds: ids }).strict();
export const BidDiffSchema = z
  .object({
    positions: keyedDiff,
    rules: keyedDiff,
    participation: keyedDiff,
    staffingBindings: keyedDiff,
    sourceDecisions: keyedDiff,
    changedSections: ids,
  })
  .strict();
const issue = z
  .object({
    path: z.array(z.union([z.string(), z.number()])),
    code: z.string(),
    message: z.string(),
  })
  .passthrough();
const mockReadiness = z
  .object({
    status: z.literal('NOT_EVALUATED'),
    code: z.literal('saved_version_required_for_mock_preview'),
  })
  .strict();
export const BidPreviewSchema = z.discriminatedUnion('valid', [
  z.object({ valid: z.literal(false), issues: z.array(issue), mockReadiness }).strict(),
  z
    .object({
      valid: z.literal(true),
      content: BidDefinitionContentSchema,
      contentSha256: digest,
      diff: BidDiffSchema,
      wouldCreateVersion: z.boolean(),
      ...summary,
      mockReadiness,
    })
    .strict(),
]);
export type CurrentBid = z.infer<typeof CurrentBidSchema>;
export type BidVersion = z.infer<typeof BidVersionSchema>;
export type BidExpected = z.infer<typeof BidExpectedSchema>;
export type BidPreview = z.infer<typeof BidPreviewSchema>;
export type HistoricalBid = z.infer<typeof HistoricalBidSchema>;
const poolSummary = z
  .object({
    officerPoolCount: z.number().int().nonnegative(),
    firefighterPoolCount: z.number().int().nonnegative(),
    excludedCount: z.number().int().nonnegative(),
    administrativeAssignmentExcludedCount: z.number().int().nonnegative(),
  })
  .strict();
export const BidMockRequestSchema = z
  .object({
    versionId: identity,
    versionSha256: digest,
    expectedContextSha256: digest,
    expectedSourceToken: digest,
  })
  .strict();
export const BidMockPreviewSchema = z.discriminatedUnion('wouldAllowCreateMock', [
  z
    .object({
      wouldAllowCreateMock: z.literal(false),
      policyError: z.string(),
      positionIds: ids.optional(),
      tenureIssues: z
        .array(
          z
            .object({ staffingPositionId: z.string(), code: z.string(), recordId: z.string() })
            .strict(),
        )
        .optional(),
    })
    .strict(),
  z
    .object({
      wouldAllowCreateMock: z.literal(true),
      versionId: identity,
      versionSha256: digest,
      versionNumber: z.number().int().positive(),
      contextSha256: digest,
      runtimeSourceToken: digest,
      pool: poolSummary,
    })
    .strict(),
]);
export const BidMockResultSchema = z
  .object({
    id: identity,
    current_phase: z.literal('config'),
    is_mock: z.literal(true),
    rule_book_version: identity,
    rule_book_revision: z.number().int().nonnegative(),
    position_template_version: identity,
    configuration_revision: z.number().int().positive(),
    settings: z
      .object({ expected_duration_days: z.number().int(), turn_timer_seconds: z.number().int() })
      .strict(),
    pool: poolSummary,
    bidDefinition: z
      .object({
        versionId: identity,
        versionNumber: z.number().int().positive(),
        versionSha256: digest,
        snapshotSha256: digest,
        contextSha256: digest,
      })
      .strict(),
    replayed: z.boolean(),
  })
  .strict()
  .refine(
    (value) => value.configuration_revision === value.bidDefinition.versionNumber,
    'Mock version identity is inconsistent.',
  );
export type BidMockPreview = z.infer<typeof BidMockPreviewSchema>;
export type BidMockResult = z.infer<typeof BidMockResultSchema>;

/** Non-success HTTP responses are distinct from an unknown mutation outcome. */
export class BidRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null,
    readonly uncertain: boolean,
    readonly issues: z.infer<typeof issue>[] = [],
  ) {
    super(code.replaceAll('_', ' '));
    this.name = 'BidRequestError';
  }
}
let mutationFetch: typeof fetch | undefined;
export async function bidRequest<T>(
  year: number,
  path: string,
  schema: z.ZodType<T>,
  options?: { body: unknown; key?: string; signal?: AbortSignal },
): Promise<T> {
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    throw new BidRequestError('invalid_bid_year', 400, false);
  const mutation = options?.key !== undefined;
  try {
    // Resolve the installed step-up wrapper at request time, including after a remount.
    mutationFetch ??= createCsrfAwareFetch(
      (input, init) => window.fetch(input, init),
      () => window.location.origin,
    );
    const response = await (options ? mutationFetch : fetch)(`/api/admin/bid/${year}/${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...(options
        ? {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(options.key ? { 'Idempotency-Key': options.key } : {}),
            },
            body: JSON.stringify(options.body),
            ...(options.signal ? { signal: options.signal } : {}),
          }
        : {}),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = z
        .object({ error: z.string().optional(), issues: z.array(issue).optional() })
        .safeParse(body);
      throw new BidRequestError(
        error.success ? (error.data.error ?? 'request_failed') : 'request_failed',
        response.status,
        mutation && (response.status >= 500 || response.status === 408),
        error.success ? error.data.issues : [],
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new BidRequestError('invalid_server_response', response.status, mutation);
    if (parsed.data !== null && typeof parsed.data === 'object') {
      const data = parsed.data;
      if ('bidYear' in data && data.bidYear !== year)
        throw new BidRequestError('invalid_server_response', response.status, mutation);
      if (
        'content' in data &&
        data.content !== null &&
        typeof data.content === 'object' &&
        'bidYear' in data.content &&
        data.content.bidYear !== year
      )
        throw new BidRequestError('invalid_server_response', response.status, mutation);
      const requestedVersion = !options && /^versions\/([^?]+)$/.exec(path)?.[1];
      if (
        requestedVersion &&
        (!('version' in data) ||
          data.version === null ||
          typeof data.version !== 'object' ||
          !('id' in data.version) ||
          data.version.id !== decodeURIComponent(requestedVersion))
      )
        throw new BidRequestError('invalid_server_response', response.status, mutation);
      if ('wouldAllowCreateMock' in data && data.wouldAllowCreateMock === true) {
        const request = z
          .object({ versionId: identity, versionSha256: digest })
          .safeParse(options?.body);
        if (
          !request.success ||
          !('versionId' in data) ||
          !('versionSha256' in data) ||
          data.versionId !== request.data.versionId ||
          data.versionSha256 !== request.data.versionSha256
        )
          throw new BidRequestError('invalid_server_response', response.status, mutation);
      }
      if (path === 'mock-sessions') {
        const request = BidMockRequestSchema.safeParse(options?.body);
        const result = BidMockResultSchema.safeParse(data);
        if (
          !request.success ||
          !result.success ||
          result.data.bidDefinition.versionId !== request.data.versionId ||
          result.data.bidDefinition.versionSha256 !== request.data.versionSha256 ||
          result.data.bidDefinition.contextSha256 !== request.data.expectedContextSha256
        )
          throw new BidRequestError('invalid_server_response', response.status, mutation);
      }
      const impactRequest = z
        .object({
          kind: z.literal('impact'),
          mode: z.enum(['mock', 'live']),
          expected: BidExpectedSchema,
          expectedImpactSha256: digest.optional(),
          changeOffset: z.number().int().nonnegative().default(0),
          intent: z.object({ operation: z.enum(['save', 'restore']) }).passthrough(),
          trace: z
            .object({
              memberId: z.number().int().positive(),
              positionId: identity,
              compareMemberId: z.number().int().positive().optional(),
            })
            .strict()
            .optional(),
        })
        .passthrough()
        .safeParse(options?.body);
      if (impactRequest.success) {
        const result = BidImpactResponseSchema.safeParse(data);
        const request = impactRequest.data;
        if (
          !result.success ||
          (result.data.valid &&
            (result.data.mode !== request.mode ||
              result.data.source.kind !==
                (request.intent.operation === 'restore' ? 'RESTORE_CANDIDATE' : 'UNSAVED_DRAFT') ||
              (request.expected.kind === 'version' &&
                result.data.source.baselineContentSha256 !== request.expected.sha256) ||
              (request.expectedImpactSha256 !== undefined &&
                result.data.impactSha256 !== request.expectedImpactSha256) ||
              (result.data.comparison.status === 'EVALUATED' &&
                result.data.comparison.eligibility.changeOffset !== request.changeOffset) ||
              JSON.stringify(result.data.trace?.selection ?? null) !==
                JSON.stringify(request.trace ?? null)))
        )
          throw new BidRequestError('invalid_server_response', response.status, mutation);
      }
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof BidRequestError) throw error;
    throw new BidRequestError('connection_interrupted', null, mutation);
  }
}
