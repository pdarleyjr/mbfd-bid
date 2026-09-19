import { getDb } from '../db/index.js';
import {
  bidDefinitionContextHash,
  compileBidDefinitionStagePolicy,
  snapshotMatchesBidDefinition,
} from './bid-definition-context.js';
import { bidSnapshotSha256, validateBidDefinitionSnapshotPin } from './bid-definition-pin.js';
import { captureBidDefinitionControl } from './bid-definition-source.js';
import { loadBidDefinitionVersion } from './bid-definition-version.js';
import { loadExplicitBidPolicySource, prepareConfiguredBidPolicySnapshot } from './bid-policy.js';

/** Build a run from an explicit immutable version without touching a year
 * designation. This is still a read-only preparation: callers must place the
 * returned source guard, session and exact serialized snapshot in one batch.
 * The integrity-checked immutable version owns managed execution material.
 * Legacy publication status cannot be changed on its sealed backing rows.
 * Live still requires normal participation, resolved sources, explicit action
 * authority and readiness at the separate session-creation boundary. */
export async function prepareBidDefinitionRun(
  database: D1Database,
  input: {
    year: number;
    versionId: string;
    versionSha256: string;
    bidSessionId: string;
    capturedAtMs: number;
    mode: 'mock' | 'live';
  },
) {
  const before = await captureBidDefinitionControl(database, input.year);
  if (!before) return { ok: false as const, code: 'bid_definition_source_changed' };
  const version = await loadBidDefinitionVersion(database, input.year, input.versionId);
  if (!version.ok) return { ok: false as const, code: version.error };
  if (version.sha256 !== input.versionSha256)
    return { ok: false as const, code: 'bid_version_hash_mismatch' };
  const db = getDb(database);
  if (input.mode === 'live' && version.content.settings?.v !== 3)
    return { ok: false as const, code: 'bid_configuration_live_policy_required' };
  const configured = await loadExplicitBidPolicySource(
    db,
    {
      year: input.year,
      ruleBookVersion: version.row.rule_book_version,
      positionTemplateVersion: version.row.position_template_version,
      configJson:
        version.content.settings === null ? null : JSON.stringify(version.content.settings),
      configurationRevision: version.row.version_number,
      annualPolicyDocumentId: version.row.policy_document_id,
    },
    // Validate the sealed backing document/book without requiring mutable
    // legacy publication flags. This does NOT choose Mock participation:
    // prepareConfiguredBidPolicySnapshot below uses the requested run mode.
    'mock',
  );
  if (!configured.ok) return configured;
  const prepared = await prepareConfiguredBidPolicySnapshot(
    db,
    configured.policy,
    input.capturedAtMs,
    input.mode,
    version.content.sourceDecisions,
  );
  if (!prepared.ok) return prepared;
  const compiledStagePolicy = compileBidDefinitionStagePolicy({
    pinnedEvaluation: prepared.snapshot,
    content: version.content,
  });
  if (!compiledStagePolicy.ok) return compiledStagePolicy;
  const executionSnapshot =
    'executionPolicy' in compiledStagePolicy
      ? prepared.snapshot.settings.v === 3
        ? {
            ...prepared.snapshot,
            // Typed authoring and a verified ordering authority may resolve
            // only this one frozen execution field. All remaining captured
            // evidence and settings retain the exact saved-version material.
            settings: {
              ...prepared.snapshot.settings,
              livePolicy: compiledStagePolicy.executionPolicy,
            },
          }
        : null
      : prepared.snapshot;
  if (executionSnapshot === null)
    return { ok: false as const, code: 'stage_authoring_compilation_invalid' };
  const after = await captureBidDefinitionControl(database, input.year);
  if (!after || before.token !== after.token)
    return { ok: false as const, code: 'bid_definition_source_changed' };
  if (!snapshotMatchesBidDefinition(executionSnapshot, version))
    return { ok: false as const, code: 'bid_version_execution_material_mismatch' };
  const contextSha256 = bidDefinitionContextHash(executionSnapshot);
  const snapshot = {
    ...executionSnapshot,
    bidDefinition: {
      v: 1 as const,
      bidSessionId: input.bidSessionId,
      bidYear: input.year,
      versionId: version.row.id,
      versionSha256: version.sha256,
      contextSha256,
    },
  };
  const snapshotJson = JSON.stringify(snapshot);
  const pins = {
    bidVersionId: version.row.id,
    bidVersionSha256: version.sha256,
    contextSha256,
    snapshotSha256: bidSnapshotSha256(snapshotJson),
  };
  const checked = validateBidDefinitionSnapshotPin({
    row: {
      ...pins,
      bidSessionId: input.bidSessionId,
      bidYear: input.year,
      ruleBookVersion: version.row.rule_book_version,
      positionTemplateVersion: version.row.position_template_version,
      ruleBookRevision: version.row.rule_book_revision,
      capturedAtMs: input.capturedAtMs,
      snapshotJson,
    },
    expectedBidSessionId: input.bidSessionId,
    version: {
      id: version.row.id,
      bidYear: input.year,
      contentSha256: version.sha256,
      ruleBookVersion: version.row.rule_book_version,
      ruleBookRevision: version.row.rule_book_revision,
      positionTemplateVersion: version.row.position_template_version,
    },
    expectedContextSha256: contextSha256,
  });
  if (!checked.ok || checked.kind !== 'pinned')
    return { ok: false as const, code: 'bid_version_execution_material_mismatch' };
  return {
    ok: true as const,
    snapshot: checked.snapshot,
    snapshotJson,
    pins,
    coverage: prepared.coverage,
    sourceGuard: before,
  };
}
