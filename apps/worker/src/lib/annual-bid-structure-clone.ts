import { BidConfigurationSettingsV2Schema, type BidDefinitionContent } from '@mbfd/shared';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { auditInsertStatement } from './audit.js';
import {
  carriedForwardStructureReviewItems,
  carryForwardBidDefinitionStructure,
} from './bid-definition-carry-forward.js';
import { loadCurrentBidDefinition } from './bid-definition-facade.js';
import { assertLegacyBidWrite, runLegacyBidWriteBatch } from './bid-definition-legacy-write.js';
import { saveBidDefinition } from './bid-definition-store.js';
import { loadBidDefinitionVersion } from './bid-definition-version.js';

type StartInput = {
  sourceYear: number;
  sourceVersionId: string;
  sourceVersionSha256: string;
  targetYear: number;
  effectiveOn: string;
  credentialEvaluationOn: string;
  expectedDurationDays: number;
  turnTimerSeconds: number;
  reason: string;
  key: string;
  actorSubject: string;
  actorId: number | null;
};

const canonicalRequest = (input: StartInput) =>
  JSON.stringify({
    source_year: input.sourceYear,
    source_version_id: input.sourceVersionId,
    source_version_sha256: input.sourceVersionSha256,
    target_year: input.targetYear,
    effective_on: input.effectiveOn,
    credential_evaluation_on: input.credentialEvaluationOn,
    expected_duration_days: input.expectedDurationDays,
    turn_timer_seconds: input.turnTimerSeconds,
    reason: input.reason,
    accept_carry_forward: true,
  });

const derivedDefinitionKey = (key: string) =>
  `annual-carry-forward:${bytesToHex(sha256(new TextEncoder().encode(key))).slice(0, 48)}`;

type LegacyExpected = { kind: 'legacy'; sourceToken: string };
type CloneState = { expected: LegacyExpected; definitionKey: string };

function parseLegacyExpected(raw: string): LegacyExpected | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { kind?: unknown }).kind === 'legacy' &&
      typeof (parsed as { sourceToken?: unknown }).sourceToken === 'string' &&
      /^[a-f0-9]{64}$/.test((parsed as { sourceToken: string }).sourceToken)
      ? (parsed as LegacyExpected)
      : null;
  } catch {
    return null;
  }
}

async function loadCloneState(database: D1Database, key: string): Promise<CloneState | null> {
  const row = await database
    .prepare(
      'SELECT initial_expected_json,definition_key FROM annual_bid_structure_clone_state WHERE idempotency_key=?',
    )
    .bind(key)
    .first<{ initial_expected_json: string; definition_key: string }>();
  if (!row) return null;
  const expected = parseLegacyExpected(row.initial_expected_json);
  return expected === null ? null : { expected, definitionKey: row.definition_key };
}

async function loadOrCreateCloneState(
  database: D1Database,
  input: StartInput,
  target: Awaited<ReturnType<typeof loadCurrentBidDefinition>>,
): Promise<CloneState | null> {
  const stored = await loadCloneState(database, input.key);
  if (stored) return stored;
  if (!target.ok || target.response.state !== 'LEGACY_UNADOPTED') return null;
  const definitionKey = derivedDefinitionKey(input.key);
  try {
    await database.batch([
      database
        .prepare(`INSERT INTO annual_bid_structure_clone_state
          (idempotency_key,target_year,initial_expected_json,definition_key,created_at)
          SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM bid_definition_heads WHERE bid_year=?)`)
        .bind(
          input.key,
          input.targetYear,
          JSON.stringify(target.response.expected),
          definitionKey,
          Date.now(),
          input.targetYear,
        ),
    ]);
  } catch {
    return null;
  }
  return loadCloneState(database, input.key);
}

function initialPlanResponse(input: StartInput, setupVersion: string) {
  return {
    sourceYear: input.sourceYear,
    sourceVersionId: input.sourceVersionId,
    sourceVersionSha256: input.sourceVersionSha256,
    targetYear: input.targetYear,
    setupVersion,
    lifecycle: 'DRAFT',
  };
}

async function replayOrCreateAnnualPlan(database: D1Database, input: StartInput) {
  const request = canonicalRequest(input);
  const previous = await database
    .prepare(
      'SELECT actor_subject,request_json,response_json FROM annual_plan_receipts WHERE idempotency_key=?',
    )
    .bind(input.key)
    .first<{ actor_subject: string; request_json: string; response_json: string }>();
  if (previous) {
    if (previous.actor_subject !== input.actorSubject || previous.request_json !== request)
      return { ok: false as const, error: 'idempotency_key_reused' as const };
    return { ok: true as const, replayed: true, response: JSON.parse(previous.response_json) };
  }
  const existing = await database
    .prepare('SELECT year FROM bid_years WHERE year=?')
    .bind(input.targetYear)
    .first();
  if (existing) return { ok: false as const, error: 'target_bid_year_exists' as const };
  await assertLegacyBidWrite(database, { kind: 'year', year: input.targetYear });
  const setupVersion = `${input.targetYear}.${Date.now()}`;
  const response = initialPlanResponse(input, setupVersion);
  const settings = BidConfigurationSettingsV2Schema.parse({
    v: 2,
    personnelEvaluationOn: input.effectiveOn,
    credentialEvaluationOn: input.credentialEvaluationOn,
    expectedDurationDays: input.expectedDurationDays,
    turnTimerSeconds: input.turnTimerSeconds,
  });
  try {
    await runLegacyBidWriteBatch(database, { kind: 'year', year: input.targetYear }, [
      database
        .prepare(`INSERT INTO annual_plan_receipts (idempotency_key,actor_subject,request_json,response_json,created_at)
          SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM bid_years WHERE year=?) THEN ? ELSE NULL END,?,?,?`)
        .bind(
          input.key,
          input.targetYear,
          input.actorSubject,
          request,
          JSON.stringify(response),
          Date.now(),
        ),
      database
        .prepare('INSERT INTO position_templates (version,effective_year,notes) VALUES (?,?,?)')
        .bind(setupVersion, input.targetYear, 'Annual Bid structure carry-forward staging'),
      database
        .prepare(
          "INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES (?,?,'draft',0,?)",
        )
        .bind(setupVersion, input.targetYear, 'Annual Bid structure carry-forward staging'),
      database
        .prepare(`INSERT INTO bid_years
          (year,status,rule_book_version,position_template_version,config_json,configuration_revision)
          VALUES (?,'configuring',?,?,?,1)`)
        .bind(input.targetYear, setupVersion, setupVersion, JSON.stringify(settings)),
      database
        .prepare(`INSERT INTO annual_plan_reviews
          (bid_year,effective_on,source_policy_text,created_at) VALUES (?,?,?,?)`)
        .bind(
          input.targetYear,
          input.effectiveOn,
          `Saved Bid structure copied from ${input.sourceYear} version ${input.sourceVersionId}; annual review required.`,
          Date.now(),
        ),
      auditInsertStatement(database, {
        bidSessionId: null,
        actorType: 'admin',
        actorId: input.actorId,
        action: 'bid_configuration_set',
        targetKind: 'bid_year',
        targetId: String(input.targetYear),
        reason: input.reason,
        afterState: response,
        clientMeta: { operation: 'annual_bid_carry_forward', annual_plan_key: input.key },
      }),
    ]);
    return { ok: true as const, replayed: false, response };
  } catch {
    const replay = await database
      .prepare(
        'SELECT actor_subject,request_json,response_json FROM annual_plan_receipts WHERE idempotency_key=?',
      )
      .bind(input.key)
      .first<{ actor_subject: string; request_json: string; response_json: string }>();
    if (replay?.actor_subject === input.actorSubject && replay.request_json === request)
      return { ok: true as const, replayed: true, response: JSON.parse(replay.response_json) };
    return { ok: false as const, error: 'annual_plan_or_source_changed' as const };
  }
}

/**
 * Creates a new target year plus one immutable, explicitly non-executable
 * Current-Bid version. The versioned seed is recoverable by the caller's
 * idempotency key and cannot silently overwrite an independently authored
 * target Bid.
 */
export async function createAnnualBidFromSavedStructure(database: D1Database, input: StartInput) {
  if (input.targetYear <= input.sourceYear)
    return { ok: false as const, error: 'target_year_must_follow_source' as const };
  if (input.effectiveOn.slice(0, 4) !== String(input.targetYear))
    return { ok: false as const, error: 'effective_year_mismatch' as const };

  const source = await loadBidDefinitionVersion(database, input.sourceYear, input.sourceVersionId);
  if (!source.ok || source.row.content_sha256 !== input.sourceVersionSha256)
    return { ok: false as const, error: 'saved_source_bid_version_unavailable' as const };

  // Validate the full non-executable target content before allocating a target
  // year, for the same no-partial-plan guarantee as source validation.
  const template = carryForwardBidDefinitionStructure({
    source: source.content as BidDefinitionContent,
    sourceVersionId: input.sourceVersionId,
    targetYear: input.targetYear,
    personnelEvaluationOn: input.effectiveOn,
    credentialEvaluationOn: input.credentialEvaluationOn,
    expectedDurationDays: input.expectedDurationDays,
    turnTimerSeconds: input.turnTimerSeconds,
  });

  // Resolve the immutable source before creating a target-year record. A stale,
  // mistyped, or unavailable version must be a no-write failure rather than a
  // partially created annual plan that an operator has to recover manually.
  const plan = await replayOrCreateAnnualPlan(database, input);
  if (!plan.ok) return plan;

  const target = await loadCurrentBidDefinition(database, input.targetYear);
  if (!target.ok) return { ok: false as const, error: 'target_bid_year_unavailable' as const };
  const cloneState = await loadOrCreateCloneState(database, input, target);
  if (!cloneState) return { ok: false as const, error: 'target_bid_definition_exists' as const };
  const saved = await saveBidDefinition(database, {
    year: input.targetYear,
    key: cloneState.definitionKey,
    actorSubject: input.actorSubject,
    actorId: input.actorId,
    expected: cloneState.expected,
    reason: `Carry forward saved Bid structure from ${input.sourceYear} version ${input.sourceVersionId}: ${input.reason}`,
    intent: { operation: 'save', content: template },
  });
  if (!saved.ok) return saved;
  return {
    ok: true as const,
    replayed: plan.replayed && saved.replayed,
    response: {
      ...plan.response,
      bidDefinition: saved.response,
      reviewItems: carriedForwardStructureReviewItems,
      notice:
        'A non-executable annual structure draft was created. Re-review every listed item before a Mock or Live preparation.',
    },
  };
}
