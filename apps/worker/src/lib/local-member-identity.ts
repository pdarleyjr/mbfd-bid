import type { JwtPayload } from '@mbfd/shared';

type LocalMemberRow = { id: number };

/**
 * Resolve the repository-local member primary key from the exact employee ID
 * asserted by the already-verified Hub session.
 *
 * Hub operational member IDs and a newly populated Bid database can occupy
 * different numeric key spaces.  Name and email matching are deliberately not
 * accepted. A present database must resolve an exact employee row before a
 * Hub numeric ID can be used as a local actor or checked against local grants.
 */
export async function withLocalMemberIdentity(
  db: D1Database | undefined,
  claims: JwtPayload,
): Promise<JwtPayload> {
  // A few Wrangler launcher tests deliberately omit D1 to prove the HTTP
  // shell's fail-closed behavior. Preserve their already-verified synthetic
  // identity; a present binding that fails still propagates the error.
  if (db === undefined) return claims;
  if (typeof db.prepare !== 'function') throw new Error('local_member_identity_unresolved');
  const employeeId = claims.emp.trim();
  if (employeeId.length === 0) throw new Error('local_member_identity_unresolved');

  const row = await db
    .prepare('SELECT id FROM members WHERE employee_id = ? LIMIT 1')
    .bind(employeeId)
    .first<LocalMemberRow>();
  if (row === null || !Number.isSafeInteger(row.id) || row.id <= 0)
    throw new Error('local_member_identity_unresolved');
  if (row.id === claims.member_id) return claims;
  return { ...claims, member_id: row.id };
}
