/**
 * A deliberately data-only readiness contract for a live Bid start.
 *
 * Collecting facts from D1, snapshots, and operational systems belongs to the
 * Worker layer. This module only evaluates those supplied facts so callers
 * cannot accidentally treat an omitted requirement as ready.
 */
export const DEFAULT_LIVE_READINESS_CHECK_IDS = [
  'current_assignments',
  'roster',
  'policy',
  'opportunities',
  'captain_queue',
  'lieutenant_queue',
  'firefighter_queue',
  'marine',
  'special_operations',
  'a_day',
  'days_tenure',
  'policy_blockers',
  'mock_test',
  'viewer',
  'transfer_date',
  'portal',
] as const;

export type LiveReadinessStatus = 'READY' | 'WARNING' | 'BLOCKING' | 'NOT_CONFIGURED';

export interface LiveReadinessCheck {
  id: string;
  status: LiveReadinessStatus;
  detail?: string;
}

export interface LiveReadinessReport {
  checks: readonly LiveReadinessCheck[];
  overallStatus: LiveReadinessStatus;
  canStartLiveBid: boolean;
  blockingCheckIds: readonly string[];
}

export interface EvaluateLiveReadinessInput {
  checks: readonly LiveReadinessCheck[];
  requiredCheckIds?: readonly string[];
}

const LIVE_READINESS_STATUSES = new Set<LiveReadinessStatus>([
  'READY',
  'WARNING',
  'BLOCKING',
  'NOT_CONFIGURED',
]);

function missingFact(id: string): LiveReadinessCheck {
  return {
    id,
    status: 'NOT_CONFIGURED',
    detail: 'No readiness fact was supplied.',
  };
}

function normalizeCheck(check: LiveReadinessCheck): LiveReadinessCheck {
  if (LIVE_READINESS_STATUSES.has(check.status)) return check;

  return {
    ...check,
    status: 'BLOCKING',
    detail: 'Readiness fact has an unsupported status value.',
  };
}

/**
 * Makes the start condition explicit: only `BLOCKING` and
 * `NOT_CONFIGURED` facts prevent a live Bid start. Warnings stay visible for
 * operator review but do not become an implicit block.
 */
export function evaluateLiveReadiness({
  checks,
  requiredCheckIds = DEFAULT_LIVE_READINESS_CHECK_IDS,
}: EvaluateLiveReadinessInput): LiveReadinessReport {
  const suppliedById = new Map<string, LiveReadinessCheck>();
  const duplicateIds = new Set<string>();

  for (const check of checks) {
    const normalizedCheck = normalizeCheck(check);
    if (suppliedById.has(normalizedCheck.id)) {
      duplicateIds.add(normalizedCheck.id);
      continue;
    }
    suppliedById.set(normalizedCheck.id, normalizedCheck);
  }

  const requiredIds = new Set(requiredCheckIds);
  const normalizedChecks: LiveReadinessCheck[] = requiredCheckIds.map(
    (id) => suppliedById.get(id) ?? missingFact(id),
  );

  for (const check of checks) {
    const normalizedCheck = normalizeCheck(check);
    if (!requiredIds.has(normalizedCheck.id) && !duplicateIds.has(normalizedCheck.id)) {
      normalizedChecks.push(normalizedCheck);
    }
  }

  for (const id of duplicateIds) {
    normalizedChecks.push({
      id: `duplicate:${id}`,
      status: 'BLOCKING',
      detail: `Multiple readiness facts were supplied for ${id}.`,
    });
  }

  const blockingCheckIds = normalizedChecks
    .filter((check) => check.status === 'BLOCKING' || check.status === 'NOT_CONFIGURED')
    .map((check) => check.id);

  const overallStatus: LiveReadinessStatus = normalizedChecks.some(
    (check) => check.status === 'BLOCKING',
  )
    ? 'BLOCKING'
    : normalizedChecks.some((check) => check.status === 'NOT_CONFIGURED')
      ? 'NOT_CONFIGURED'
      : normalizedChecks.some((check) => check.status === 'WARNING')
        ? 'WARNING'
        : 'READY';

  return {
    checks: normalizedChecks,
    overallStatus,
    canStartLiveBid: blockingCheckIds.length === 0,
    blockingCheckIds,
  };
}
