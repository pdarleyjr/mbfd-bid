import type { FrozenLiveBidPolicy } from '@mbfd/shared';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { getDb } from '../db/index.js';
import { loadBidSessionPolicySnapshot } from './bid-policy.js';

export class BidDefinitionIntegrityError extends Error {
  constructor() {
    super('session_policy_snapshot_integrity_invalid');
    this.name = 'BidDefinitionIntegrityError';
  }
}

/** Guard managed commands and recovery before receipt replay, reduction or DO
 * projection. Historical unpinned runs retain their existing legacy checks.
 * This calls only frozen source readers, never canonical-state loaders. */
export async function assertBidDefinitionRunIntegrity(
  database: D1Database,
  bidSessionId: string,
  policy?: FrozenLiveBidPolicy,
) {
  const row = await database
    .prepare(`SELECT p.bid_version_id,p.bid_version_sha256,p.snapshot_sha256,p.context_sha256,
    json_type(p.snapshot_json,'$.bidDefinition') AS body_pin_type,
    EXISTS(SELECT 1 FROM bid_definition_versions v WHERE v.rule_book_version=p.rule_book_version
      OR v.position_template_version=p.position_template_version) AS owned
    FROM bid_session_policy_snapshots p WHERE p.bid_session_id=?`)
    .bind(bidSessionId)
    .first<{
      bid_version_id: string | null;
      bid_version_sha256: string | null;
      snapshot_sha256: string | null;
      context_sha256: string | null;
      body_pin_type: string | null;
      owned: number;
    }>();
  if (
    !row ||
    (row.owned === 0 &&
      row.body_pin_type === null &&
      [row.bid_version_id, row.bid_version_sha256, row.snapshot_sha256, row.context_sha256].every(
        (value) => value === null,
      ))
  )
    return null;
  const loaded = await loadBidSessionPolicySnapshot(getDb(database), bidSessionId);
  if (!loaded.snapshot || loaded.snapshot.v !== 3 || !('bidDefinition' in loaded.snapshot))
    throw new BidDefinitionIntegrityError();
  if (
    policy &&
    (loaded.snapshot.settings.v !== 3 ||
      canonicalize(policy as JsonValue) !==
        canonicalize(loaded.snapshot.settings.livePolicy as JsonValue))
  )
    throw new BidDefinitionIntegrityError();
  if (
    row.bid_version_id === null ||
    row.bid_version_sha256 === null ||
    row.snapshot_sha256 === null ||
    row.context_sha256 === null
  )
    throw new BidDefinitionIntegrityError();
  return {
    bidVersionId: row.bid_version_id,
    bidVersionSha256: row.bid_version_sha256,
    snapshotSha256: row.snapshot_sha256,
    contextSha256: row.context_sha256,
  };
}
