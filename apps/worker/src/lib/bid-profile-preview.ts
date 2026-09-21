import { BidDefinitionContentSchema, BidProfileReviewResponseSchema } from '@mbfd/shared';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { getDb } from '../db/index.js';
import { annualEligibilityImpact } from './annual-eligibility-impact.js';
import { bidContentHash, canonicalBidDefinition } from './bid-definition-content.js';
import { bidDefinitionContextHash } from './bid-definition-context.js';
import { loadCurrentBidDefinition } from './bid-definition-facade.js';
import { prepareDefinition } from './bid-definition-impact.js';
import { captureBidDefinitionControl } from './bid-definition-source.js';
import { SaveBidDefinitionSchema } from './bid-definition-store.js';
import { loadBidDefinitionVersion } from './bid-definition-version.js';
import { eligibilityMemberFromFrozen, loadBidEvaluationEvidence } from './bid-policy.js';
import {
  compileADayTimingExceptionScopes,
  materializeBidDefinitionProfiles,
} from './bid-profile-review.js';

const canonical = (value: unknown) => canonicalize(value as JsonValue);

function profileDraftCandidate(raw: unknown) {
  const parsed = BidDefinitionContentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, issues: parsed.error.issues };
  if (parsed.data.authoring?.reconciliation !== 'PROFILE_EDITS_PENDING_REVIEW')
    return canonicalBidDefinition(parsed.data);
  // Pending topology edits may still carry derived rules for a closed or
  // removed opportunity. Compile before canonical coverage checks, as Save
  // does, while binding the review source to the complete authored draft.
  return {
    ok: true as const,
    content: parsed.data,
    sha256: bidContentHash(canonical(parsed.data)),
  };
}

export const BidProfileReviewRequestSchema = z
  .object({
    kind: z.literal('profile-review'),
    expected: SaveBidDefinitionSchema.shape.expected,
    intent: SaveBidDefinitionSchema.shape.intent,
  })
  .strict();

/** Optional read-only review. Save uses the same pure compiler; no review token
 * grants authority or substitutes for the current head/source guards. */
export async function previewBidProfiles(
  database: D1Database,
  year: number,
  input: z.infer<typeof BidProfileReviewRequestSchema>,
) {
  const control = await captureBidDefinitionControl(database, year);
  if (!control) return { ok: false as const, error: 'bid_definition_source_changed' };
  const current = await loadCurrentBidDefinition(database, year);
  if (!current.ok) return current;
  if (canonical(current.response.expected) !== canonical(input.expected))
    return { ok: false as const, error: 'bid_definition_or_source_changed' };
  const baseline = canonicalBidDefinition(current.response.content);
  if (!baseline.ok) return { ok: false as const, error: 'bid_definition_source_invalid' };
  const candidate =
    input.intent.operation === 'restore'
      ? await loadBidDefinitionVersion(database, year, input.intent.versionId)
      : profileDraftCandidate(input.intent.content);
  if (!candidate.ok)
    return 'error' in candidate
      ? candidate
      : {
          ok: true as const,
          response: BidProfileReviewResponseSchema.parse({
            valid: false,
            kind: 'INVALID_CANDIDATE',
            issues: candidate.issues,
          }),
        };
  if (candidate.content.bidYear !== year)
    return { ok: false as const, error: 'bid_definition_year_mismatch' };
  if (
    input.intent.operation === 'restore' &&
    candidate.content.authoring?.reconciliation !== 'MATERIALIZED_FOR_CURRENT_VERSION'
  )
    return {
      ok: true as const,
      response: BidProfileReviewResponseSchema.parse({
        valid: false,
        kind: 'PROFILE_AUTHORING_UNAVAILABLE',
        code: 'restore_preserves_historical_concrete_rules',
      }),
    };
  const materialized = materializeBidDefinitionProfiles(candidate.content);
  const capturedAtMs = Date.now();
  const source = {
    kind:
      input.intent.operation === 'restore'
        ? ('RESTORE_CANDIDATE' as const)
        : ('UNSAVED_DRAFT' as const),
    baselineContentSha256: baseline.sha256,
    candidateContentSha256: candidate.sha256,
  };
  if (!materialized.ok)
    return {
      ok: true as const,
      response: BidProfileReviewResponseSchema.parse(
        materialized.code === 'profile_authoring_unavailable'
          ? { valid: false, kind: 'PROFILE_AUTHORING_UNAVAILABLE', code: materialized.code }
          : {
              valid: false,
              kind: 'PROFILE_COMPILATION_CONFLICT',
              v: 1,
              bidYear: year,
              source,
              capturedAtMs,
              runtimeSourceToken: control.token,
              profileMappings: materialized.profileMappings,
              conflicts: materialized.conflicts,
            },
      ),
    };
  const timing = compileADayTimingExceptionScopes(materialized.content);
  if (!timing.ok)
    return {
      ok: true as const,
      response: BidProfileReviewResponseSchema.parse({
        valid: false,
        kind: 'PROFILE_COMPILATION_CONFLICT',
        v: 1,
        bidYear: year,
        source,
        capturedAtMs,
        runtimeSourceToken: control.token,
        profileMappings: materialized.profileMappings,
        conflicts: timing.conflicts,
      }),
    };
  const compiled = canonicalBidDefinition(timing.content);
  if (!compiled.ok)
    return {
      ok: true as const,
      response: BidProfileReviewResponseSchema.parse({
        valid: false,
        kind: 'INVALID_CANDIDATE',
        issues: compiled.issues,
      }),
    };
  const beforeRules = new Map(
    baseline.content.rules.map((rule) => [rule.positionId, canonical(rule)]),
  );
  const afterRules = new Map(
    compiled.content.rules.map((rule) => [rule.positionId, canonical(rule)]),
  );
  const affectedPositionIds = [...new Set([...beforeRules.keys(), ...afterRules.keys()])]
    .filter((id) => beforeRules.get(id) !== afterRules.get(id))
    .sort();
  const db = getDb(database);
  const evidence = await loadBidEvaluationEvidence(db, year);
  const [before, after] = await Promise.all([
    prepareDefinition(db, baseline.content, baseline.coverage, evidence, capturedAtMs, 'live'),
    prepareDefinition(db, compiled.content, compiled.coverage, evidence, capturedAtMs, 'live'),
  ]);
  let eligibilityChangeCount: number | null = null;
  let scoringChangeCount: number | null = null;
  let relativePriorityChangeCount: number | null = null;
  let impact:
    | { status: 'UNAVAILABLE'; code: string }
    | { status: 'EVALUATED'; contextSha256: string; evaluatedComparisonCount: number } = {
    status: 'UNAVAILABLE',
    code: 'both_definitions_must_be_evaluable',
  };
  if (before.ok && after.ok) {
    eligibilityChangeCount = 0;
    scoringChangeCount = 0;
    relativePriorityChangeCount = 0;
    const cohort = after.evaluation.members
      .filter((member) => member.pool !== 'EXCLUDED')
      .map((member) => ({
        memberId: member.memberId,
        evidence: eligibilityMemberFromFrozen(member),
      }));
    const result = annualEligibilityImpact(
      {
        beforeMembers: cohort,
        afterMembers: cohort,
        beforeRules: before.coverage.rules,
        afterRules: after.coverage.rules,
      },
      {
        change: (cause, change) => {
          if (cause === 'POLICY') {
            if (change.before.eligible !== change.after.eligible)
              eligibilityChangeCount = (eligibilityChangeCount ?? 0) + 1;
            if (
              change.before.points !== change.after.points ||
              change.before.soPoints !== change.after.soPoints ||
              change.before.moPoints !== change.after.moPoints
            )
              scoringChangeCount = (scoringChangeCount ?? 0) + 1;
            if (change.before.priority !== change.after.priority)
              relativePriorityChangeCount = (relativePriorityChangeCount ?? 0) + 1;
          }
          return false;
        },
      },
    );
    impact = {
      status: 'EVALUATED',
      contextSha256: bidDefinitionContextHash(after.evaluation),
      evaluatedComparisonCount: result.evaluatedComparisons,
    };
  }
  const refreshed = await loadCurrentBidDefinition(database, year);
  const afterControl = await captureBidDefinitionControl(database, year);
  if (
    !refreshed.ok ||
    canonical(refreshed.response.expected) !== canonical(input.expected) ||
    afterControl?.token !== control.token
  )
    return { ok: false as const, error: 'bid_definition_or_source_changed' };
  const review = {
    valid: true as const,
    kind: 'MATERIALIZED' as const,
    v: 1 as const,
    bidYear: year,
    source,
    capturedAtMs,
    runtimeSourceToken: control.token,
    profileMappings: materialized.profileMappings,
    materialized: {
      content: compiled.content,
      contentSha256: compiled.sha256,
      compiled: compiled.content.authoring?.compiled ?? [],
    },
    summary: {
      affectedPositionIds,
      affectedPositionCount: affectedPositionIds.length,
      eligibilityChangeCount,
      scoringChangeCount,
      relativePriorityChangeCount,
      impact,
      selectionConsequences: {
        status: 'REQUIRES_SELECTION_CONTEXT',
        areas: ['A_DAY_CAPACITY', 'NEXT_BIDDER', 'SPECIALTY_INTERRUPTION', 'POSITION_AWARDS'],
      },
    },
  };
  return {
    ok: true as const,
    response: BidProfileReviewResponseSchema.parse({
      ...review,
      reviewSha256: bidContentHash(canonical(review)),
    }),
  };
}
