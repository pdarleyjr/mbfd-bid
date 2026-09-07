import { z } from 'zod';
import { auditInsertStatement } from './audit.js';
import { isIsoCalendarDate } from './personnel-lifecycle.js';

export const CatalogEditSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    fy_points_default: z.number().int().min(0).max(10000),
    expected_revision: z.number().int().nonnegative(),
    retired_on: z.string().refine(isIsoCalendarDate).nullable().optional(),
    reason: z.string().trim().min(4).max(500),
  })
  .strict();

export interface CatalogEntry {
  id: number;
  name: string;
  policyName: string;
  fyPointsDefault: number;
  holderCount: number;
  revision: number;
  retiredOn: string | null;
}

export const CATALOG_SELECT = `SELECT c.id, COALESCE(meta.display_name, c.name) AS name,
  c.name AS policyName, c.fy_points_default AS fyPointsDefault,
  (SELECT count(DISTINCT member_id) FROM (SELECT member_id,credential_id FROM member_credentials UNION SELECT member_id,credential_id FROM member_qualification_events WHERE credential_id IS NOT NULL) refs WHERE refs.credential_id=c.id) AS holderCount,
  COALESCE(meta.revision, 0) AS revision, meta.retired_on AS retiredOn
  FROM credentials c LEFT JOIN credential_catalog_metadata meta ON meta.credential_id = c.id`;

export async function loadCatalogEntry(db: D1Database, id: number) {
  return db.prepare(`${CATALOG_SELECT} WHERE c.id = ?`).bind(id).first<CatalogEntry>();
}

export async function catalogDependencies(db: D1Database, id: number) {
  const entry = await loadCatalogEntry(db, id);
  if (!entry) return null;
  const references = await db
    .prepare(`SELECT DISTINCT b.version, b.status FROM rule_books b
    JOIN position_rules r ON r.rule_book_version = b.version
    WHERE EXISTS (SELECT 1 FROM json_tree(r.required_criteria) WHERE value = ?)
      OR EXISTS (SELECT 1 FROM json_tree(r.points_preference) WHERE value = ?)
    UNION SELECT p.rule_book_version AS version, CASE WHEN p.status = 'PUBLISHED' THEN 'active' WHEN p.status = 'DRAFT' THEN 'draft' ELSE 'archived' END AS status
      FROM annual_bid_policy_documents p WHERE EXISTS (SELECT 1 FROM json_tree(p.execution_policy_json) WHERE value = ?)`)
    .bind(entry.policyName, entry.policyName, entry.policyName)
    .all<{ version: string; status: string }>();
  const frozen = await db
    .prepare(`SELECT snapshot.bid_session_id AS sessionId, session.bid_year AS year, session.is_mock AS isMock
    FROM bid_session_policy_snapshots snapshot JOIN bid_sessions session ON session.id=snapshot.bid_session_id
    WHERE EXISTS (SELECT 1 FROM json_tree(snapshot.snapshot_json) WHERE value=?)
      OR EXISTS (SELECT 1 FROM json_each(snapshot.snapshot_json,'$.ruleBookMaterial.rules') rule,
        json_tree(COALESCE(json_extract(rule.value,'$.requiredCriteriaJson'),'{}')) criteria WHERE criteria.value=?)
      OR EXISTS (SELECT 1 FROM json_each(snapshot.snapshot_json,'$.ruleBookMaterial.rules') rule,
        json_tree(COALESCE(json_extract(rule.value,'$.pointsPreferenceJson'),'{}')) points WHERE points.value=?)
    ORDER BY session.bid_year DESC,snapshot.bid_session_id`)
    .bind(entry.policyName, entry.policyName, entry.policyName)
    .all<{ sessionId: string; year: number; isMock: number }>();
  const evidence = await db
    .prepare(`SELECT
    (SELECT COUNT(*) FROM member_qualification_events WHERE credential_id=?) AS eventCount,
    (SELECT COUNT(*) FROM (SELECT member_id FROM member_credentials WHERE credential_id=? UNION SELECT member_id FROM member_qualification_events WHERE credential_id=?)) AS memberCount`)
    .bind(id, id, id)
    .first<{ eventCount: number; memberCount: number }>();
  return {
    credentialId: id,
    revision: entry.revision,
    policyReferences: references.results,
    memberReferences: evidence?.memberCount ?? entry.holderCount,
    qualificationEventReferences: evidence?.eventCount ?? 0,
    frozenSessionReferences: frozen.results,
    retirementBlocked: references.results.some((r) => r.status === 'active'),
    notice:
      'Retirement preserves qualification evidence and frozen sessions. Replace dependencies in reviewed drafts before publishing their successor.',
  };
}

/** Stable IDs and immutable policy names remain usable by all legacy readers. */
export async function editCatalogEntry(
  db: D1Database,
  input: {
    id: number;
    key: string;
    actorSubject: string;
    actorId: number | null;
    body: z.infer<typeof CatalogEditSchema>;
  },
): Promise<
  { ok: true; replayed: boolean; credential: CatalogEntry } | { ok: false; error: string }
> {
  const request = JSON.stringify(input.body);
  const replay = async () => {
    const receipt = await db
      .prepare('SELECT * FROM credential_catalog_receipts WHERE idempotency_key = ?')
      .bind(input.key)
      .first<{
        credential_id: number;
        actor_subject: string;
        request_json: string;
        response_json: string;
      }>();
    if (!receipt) return null;
    if (
      receipt.credential_id !== input.id ||
      receipt.actor_subject !== input.actorSubject ||
      receipt.request_json !== request
    )
      return { ok: false as const, error: 'idempotency_key_reused' };
    return {
      ok: true as const,
      replayed: true,
      credential: JSON.parse(receipt.response_json) as CatalogEntry,
    };
  };
  const prior = await replay();
  if (prior) return prior;
  const before = await loadCatalogEntry(db, input.id);
  if (!before) return { ok: false, error: 'not_found' };
  if (before.revision !== input.body.expected_revision)
    return { ok: false, error: 'credential_revision_changed' };
  if (input.body.retired_on && input.body.retired_on !== before.retiredOn) {
    const dependencies = await catalogDependencies(db, input.id);
    if (dependencies?.retirementBlocked)
      return { ok: false, error: 'credential_active_policy_dependency' };
  }
  // Retirement ends availability for new authoring; it never revokes a member's evidence.
  const after: CatalogEntry = {
    ...before,
    name: input.body.name,
    fyPointsDefault: input.body.fy_points_default,
    revision: before.revision + 1 + Number(before.fyPointsDefault !== input.body.fy_points_default),
    retiredOn: input.body.retired_on === undefined ? before.retiredOn : input.body.retired_on,
  };
  try {
    const result = await db.batch([
      db
        .prepare(`INSERT INTO credential_catalog_metadata (credential_id, display_name, revision, retired_on)
        SELECT ?, ?, ?, ? WHERE
          COALESCE((SELECT revision FROM credential_catalog_metadata WHERE credential_id = ?), 0) = ?
          AND NOT EXISTS (SELECT 1 FROM credentials c LEFT JOIN credential_catalog_metadata m ON m.credential_id = c.id
            WHERE c.id <> ? AND (c.name = ? OR m.display_name = ?))
        ON CONFLICT(credential_id) DO UPDATE SET display_name = excluded.display_name,
          revision = excluded.revision, retired_on = excluded.retired_on`)
        .bind(
          input.id,
          after.name,
          before.revision + 1,
          after.retiredOn,
          input.id,
          before.revision,
          input.id,
          after.name,
          after.name,
        ),
      db
        .prepare('UPDATE credentials SET fy_points_default = ? WHERE id = ? AND changes() = 1')
        .bind(after.fyPointsDefault, input.id),
      db
        .prepare(`INSERT INTO credential_catalog_receipts
        (idempotency_key, credential_id, actor_subject, request_json, response_json, created_at)
        SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
        .bind(input.key, input.id, input.actorSubject, request, JSON.stringify(after), Date.now()),
      auditInsertStatement(
        db,
        {
          bidSessionId: null,
          actorType: 'admin',
          actorId: input.actorId,
          action: 'credential_update',
          targetKind: 'credential',
          targetId: String(input.id),
          beforeState: before,
          afterState: after,
          reason: input.body.reason,
          clientMeta: { catalog_mutation_key: input.key },
        },
        new Date(),
        true,
      ),
    ]);
    if (result.some((r) => r.meta.changes !== 1))
      return { ok: false, error: 'credential_revision_or_name_changed' };
    return { ok: true, replayed: false, credential: after };
  } catch (error) {
    const receipt = await replay();
    if (receipt) return receipt;
    if (String(error).includes('credential is referenced by active policy'))
      return { ok: false, error: 'credential_active_policy_dependency' };
    throw error;
  }
}
