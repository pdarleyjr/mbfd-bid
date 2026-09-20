/** Legacy writers must not touch managed runs before their first canonical
 * command. Presence of a version pin is a boundary even if its material later
 * fails validation; this predicate never grants execution authority.
 * Session start is the separately validated canonical initialization path.
 */
export async function requiresCanonicalBidMutation(
  db: D1Database,
  bidSessionId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS required FROM canonical_bid_session_state WHERE bid_session_id = ?
       UNION ALL
       SELECT 1 AS required FROM bid_session_policy_snapshots
        WHERE bid_session_id = ? AND (bid_version_id IS NOT NULL
          OR bid_version_sha256 IS NOT NULL OR snapshot_sha256 IS NOT NULL
          OR context_sha256 IS NOT NULL)
       LIMIT 1`,
    )
    .bind(bidSessionId, bidSessionId)
    .first();
  return row !== null;
}
