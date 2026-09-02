import {
  type LiveReadinessCheck,
  type LiveReadinessReport,
  evaluateLiveReadiness,
} from '@mbfd/shared';
import { and, eq, ne } from 'drizzle-orm';

import type { DB } from '../db/index.js';
import { bidSessions } from '../db/schema.js';
import type { WorkerEnv } from '../types/env.js';
import { validateAnnualOperationsReadiness } from './annual-bid-operations.js';
import { evaluateAuthoritativeStaffingBaseline } from './authoritative-staffing-baseline.js';
import { type FrozenSessionBidPolicy, loadConfiguredBidYearPolicy } from './bid-policy.js';

export interface LiveBidReadinessInput {
  db: DB;
  env: WorkerEnv;
  bidSessionId: string;
  bidYear: number;
  frozenPolicy: Extract<FrozenSessionBidPolicy, { ok: true }>;
  /** The caller has already enforced both admin role and fresh step-up auth. */
  operatorAuthorized: boolean;
}

function check(id: string, ready: boolean, detail: string): LiveReadinessCheck {
  return { id, status: ready ? 'READY' : 'BLOCKING', detail };
}

function hasRuntimeBindings(env: WorkerEnv): boolean {
  return Boolean(
    env.DB &&
      env.KV &&
      typeof env.KV.get === 'function' &&
      typeof env.KV.put === 'function' &&
      env.BID_SESSION &&
      typeof env.BID_SESSION.idFromName === 'function' &&
      env.R2_AUDIT &&
      typeof env.R2_AUDIT.put === 'function' &&
      env.R2_EXPORTS &&
      typeof env.R2_EXPORTS.put === 'function',
  );
}

function hasAuditInfrastructure(env: WorkerEnv): boolean {
  return Boolean(
    env.AUDIT_SIGNING_PRIVKEY?.trim() &&
      env.AUDIT_SIGNING_PUBKEY?.trim() &&
      env.R2_AUDIT &&
      typeof env.R2_AUDIT.put === 'function',
  );
}

/**
 * The only permitted live writeback state before a production Bid is started.
 * A reader credential does not imply write authority; the writer must be
 * absent and the feature must be literally disabled.
 */
function isWritebackSafe(env: WorkerEnv): boolean {
  return (
    env.PORTAL_WRITEBACK_ENABLED === 'false' &&
    !env.PORTAL_BID_WRITER &&
    env.PORTAL_WRITEBACK_BASE_URL === 'https://portal-writeback-disabled.invalid'
  );
}

/**
 * Re-evaluates every source-of-truth fact needed to start a real Bid. This is
 * intentionally a read-only operation and is shared by the operator evidence
 * endpoint and the state-changing start endpoint.
 */
export async function evaluateLiveBidReadiness(
  input: LiveBidReadinessInput,
): Promise<LiveReadinessReport> {
  const { db, env, bidSessionId, bidYear, frozenPolicy, operatorAuthorized } = input;
  const [baseline, currentPolicy, conflicts] = await Promise.all([
    evaluateAuthoritativeStaffingBaseline(db, bidYear),
    loadConfiguredBidYearPolicy(db, bidYear, 'live'),
    db
      .select({ id: bidSessions.id, phase: bidSessions.currentPhase })
      .from(bidSessions)
      .where(
        and(
          eq(bidSessions.bidYear, bidYear),
          eq(bidSessions.isMock, false),
          ne(bidSessions.id, bidSessionId),
          ne(bidSessions.currentPhase, 'complete'),
        ),
      )
      .all(),
  ]);

  const snapshot = frozenPolicy.snapshot;
  const frozenBaseline = snapshot.staffingBaseline;
  const baselineMatches =
    baseline.status === 'PASS' &&
    frozenBaseline !== undefined &&
    baseline.baselineAcceptanceId === frozenBaseline.baselineAcceptanceId &&
    baseline.importId === frozenBaseline.importId &&
    baseline.sourceHash === frozenBaseline.sourceHash;
  const configMatches =
    currentPolicy.ok &&
    currentPolicy.policy.ruleBookVersion === snapshot.ruleBookVersion &&
    currentPolicy.policy.ruleBookRevision === snapshot.ruleBookRevision &&
    currentPolicy.policy.positionTemplateVersion === snapshot.positionTemplateVersion &&
    currentPolicy.policy.configurationRevision === snapshot.configurationRevision;
  const biddablePositions = snapshot.ruleBookMaterial.positions.filter(
    (position) => position.bidParticipation === 'BIDDABLE',
  );
  const participatingMembers = snapshot.members.filter((member) => member.pool !== 'EXCLUDED');
  const ruleIds = new Set(snapshot.ruleBookMaterial.rules.map((rule) => rule.positionId));
  const rulesCoverBiddablePositions =
    biddablePositions.length > 0 && biddablePositions.every((position) => ruleIds.has(position.id));
  const annualOperations =
    snapshot.settings.v === 3 ? snapshot.settings.livePolicy.annualOperations : undefined;
  const annualReadiness = validateAnnualOperationsReadiness({
    operations: annualOperations,
    bidYear,
    isMock: false,
    configuredStageIds:
      snapshot.settings.v === 3 ? snapshot.settings.livePolicy.stages.map((stage) => stage.id) : [],
    // Exact specialty seats are frozen configuration. Current staffing never
    // creates a topology id; missing configured ids therefore block a real run.
    missingTopologyIds: annualOperations
      ? annualOperations.requiredTopologyPositionIds.filter(
          (positionId) =>
            !snapshot.ruleBookMaterial.positions.some((position) => position.id === positionId),
        )
      : [],
  });

  return evaluateLiveReadiness({
    requiredCheckIds: [
      'accepted_staffing_baseline',
      'annual_configuration',
      'frozen_policy_snapshot',
      'participant_population',
      'position_catalog',
      'qualification_rule_readiness',
      'annual_operations_policy',
      'no_conflicting_active_real_bid',
      'audit_infrastructure',
      'runtime_bindings',
      'operator_authorization',
      'writeback_safety',
    ],
    checks: [
      check(
        'accepted_staffing_baseline',
        baselineMatches,
        baselineMatches
          ? `Accepted official baseline ${frozenBaseline.importId} remains complete and matches the frozen session.`
          : `The accepted staffing baseline is absent, incomplete, or differs from the frozen session (${baseline.blockingCodes.join(', ') || 'frozen_baseline_mismatch'}).`,
      ),
      check(
        'annual_configuration',
        configMatches,
        configMatches
          ? `Active annual configuration revision ${snapshot.configurationRevision} matches the frozen session.`
          : `The designated active annual configuration no longer matches the frozen session${
              currentPolicy.ok ? '' : ` (${currentPolicy.code})`
            }.`,
      ),
      check(
        'frozen_policy_snapshot',
        frozenPolicy.coverage.valid &&
          snapshot.v === 3 &&
          snapshot.credentialEvaluationOn !== undefined,
        'Session policy is materialized, versioned, and includes the explicit credential evaluation date.',
      ),
      check(
        'participant_population',
        participatingMembers.length > 0,
        `${participatingMembers.length} frozen participants are eligible for the session.`,
      ),
      check(
        'position_catalog',
        biddablePositions.length > 0,
        `${biddablePositions.length} biddable positions are frozen into the session.`,
      ),
      check(
        'qualification_rule_readiness',
        rulesCoverBiddablePositions,
        rulesCoverBiddablePositions
          ? 'Every frozen biddable position has immutable rule coverage.'
          : 'One or more frozen biddable positions lacks immutable rule coverage.',
      ),
      check(
        'annual_operations_policy',
        annualReadiness.ok,
        annualReadiness.ok
          ? 'Annual stage, contact, and A-Day execution policy is frozen and complete.'
          : `Annual operations cannot start: ${annualReadiness.code}${
              'detail' in annualReadiness && annualReadiness.detail
                ? ` (${annualReadiness.detail})`
                : ''
            }.`,
      ),
      check(
        'no_conflicting_active_real_bid',
        conflicts.length === 0,
        conflicts.length === 0
          ? 'No other nonterminal real Bid exists for this annual configuration.'
          : `Conflicting real sessions: ${conflicts.map((session) => session.id).join(', ')}.`,
      ),
      check(
        'audit_infrastructure',
        hasAuditInfrastructure(env),
        'Signing keys and the authoritative R2 audit binding are required before a real start.',
      ),
      check(
        'runtime_bindings',
        hasRuntimeBindings(env),
        'D1, KV, Durable Object, and R2 bindings must all be present.',
      ),
      check(
        'operator_authorization',
        operatorAuthorized,
        'A fresh, server-verified administrator authorization is required.',
      ),
      check(
        'writeback_safety',
        isWritebackSafe(env),
        'Writeback must be literally disabled, with no writer credential and the disabled origin.',
      ),
    ],
  });
}
