import type { Role } from '@mbfd/shared';

/** Identity verified by the public Worker before a request enters a named DO. */
export interface VerifiedWebSocketIdentity {
  memberId: number;
  role: Role;
}

const MEMBER_ID_HEADER = 'X-MBFD-Member-Id';
const ROLE_HEADER = 'X-MBFD-Role';

/**
 * Serialize verified JWT claims for the internal Durable Object service
 * binding. These headers are never accepted from a public request.
 */
export function verifiedWebSocketIdentityHeaders(
  identity: VerifiedWebSocketIdentity,
): Record<string, string> {
  return {
    [MEMBER_ID_HEADER]: String(identity.memberId),
    [ROLE_HEADER]: identity.role,
  };
}

/**
 * Parse the identity that the public route supplied through the internal DO
 * binding. A direct/forged DO request fails closed rather than defaulting to
 * a synthetic member.
 */
export function parseVerifiedWebSocketIdentity(headers: Headers): VerifiedWebSocketIdentity | null {
  const rawMemberId = headers.get(MEMBER_ID_HEADER);
  const role = headers.get(ROLE_HEADER);
  if (rawMemberId === null || role === null || !/^(?:0|[1-9]\d*)$/.test(rawMemberId)) {
    return null;
  }

  const memberId = Number(rawMemberId);
  if (!Number.isSafeInteger(memberId) || (role !== 'member' && role !== 'admin')) {
    return null;
  }
  // Member 0 is the synthetic local-admin identity and must never be
  // represented as a normal member connection.
  if (memberId === 0 && role !== 'admin') return null;

  return { memberId, role };
}
