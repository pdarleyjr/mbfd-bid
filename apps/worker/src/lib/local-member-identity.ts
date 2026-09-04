import type { JwtPayload } from '@mbfd/shared';

type LocalMemberRow = { id: number };

/**
 * Resolve the repository-local member primary key from the exact employee ID
 * asserted by the already-verified Hub session.
 *
 * Hub operational member IDs and a newly populated Bid database can occupy
 * different numeric key spaces.  Name and email matching are deliberately not
 * accepted.  When this database has no exact employee row yet, retain the Hub
 * member ID so an empty environment can still be initialized normally.
 */
export async function withLocalMemberIdentity(
  db: D1Database | undefined,
  claims: JwtPayload,
): Promise<JwtPayload> {
  const employeeId = claims.emp.trim();
  if (employeeId.length === 0) return claims;
  // A few Wrangler launcher tests deliberately omit D1 to prove the HTTP
  // shell's fail-closed behavior. Preserve their already-verified synthetic
  // identity; a present binding that fails still propagates the error.
  if (db === undefined || typeof db.prepare !== 'function') return claims;

  const row = await db
    .prepare('SELECT id FROM members WHERE employee_id = ? LIMIT 1')
    .bind(employeeId)
    .first<LocalMemberRow>();
  if (row === null || !Number.isSafeInteger(row.id) || row.id <= 0) return claims;
  if (row.id === claims.member_id) return claims;
  return { ...claims, member_id: row.id };
}
