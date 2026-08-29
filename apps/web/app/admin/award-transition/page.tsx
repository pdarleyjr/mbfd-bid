import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';

import {
  type AwardTransitionOperatorContext,
  AwardTransitionWorkspace,
} from './AwardTransitionWorkspace';

export const dynamic = 'force-dynamic';

type ApiRecord = Record<string, unknown>;

function asRecord(value: unknown): ApiRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ApiRecord)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function validSessionId(value: string | undefined): string | null {
  if (value === undefined || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) return null;
  return value;
}

function membershipLabel(value: unknown): [number, string] | null {
  const row = asRecord(value);
  if (row === null) return null;
  const id = asPositiveInteger(row.id);
  const firstName = asNonEmptyString(row.first_name);
  const lastName = asNonEmptyString(row.last_name);
  const rank = asNonEmptyString(row.rank);
  if (id === null || firstName === null || lastName === null || rank === null) return null;
  return [id, `${firstName} ${lastName} · ${rank}`];
}

function staffingLabel(value: unknown): [string, string] | null {
  const row = asRecord(value);
  if (row === null) return null;
  const id = asNonEmptyString(row.id);
  const station = asNonEmptyString(row.station);
  const unit = asNonEmptyString(row.unit);
  const positionName = asNonEmptyString(row.positionName);
  if (id === null || station === null || unit === null || positionName === null) return null;
  return [id, `Station ${station} · ${unit} · ${positionName}`];
}

function bidPositionLabel(value: unknown): [string, string] | null {
  const row = asRecord(value);
  if (row === null) return null;
  const id = asNonEmptyString(row.id);
  const station = asNonEmptyString(row.station);
  const unit = asNonEmptyString(row.unit);
  const positionName = asNonEmptyString(row.positionName);
  if (id === null || station === null || unit === null || positionName === null) return null;
  return [id, `${id} · ${positionName} · Station ${station} · ${unit}`];
}

/**
 * Resolves user-facing names and seats only from authenticated, read-only
 * sources. Failure to assemble that context leaves transition preview blocked
 * instead of falling back to copied opaque identifiers.
 */
async function loadOperatorContext(sessionId: string): Promise<{
  context: AwardTransitionOperatorContext | null;
  error: string | null;
}> {
  try {
    const [snapshotResponse, membersResponse, rosterResponse] = await Promise.all([
      serverWorkerFetch(`/api/admin/bid-session/${encodeURIComponent(sessionId)}/policy-snapshot`),
      serverWorkerFetch('/api/admin/members/roster'),
      serverWorkerFetch('/api/admin/current-roster'),
    ]);
    if (!snapshotResponse.ok || !membersResponse.ok || !rosterResponse.ok) {
      return {
        context: null,
        error:
          'The selected session’s reviewed operator context could not be loaded. No transition preview is available.',
      };
    }

    const snapshotBody = asRecord(await snapshotResponse.json());
    const snapshot = snapshotBody === null ? null : asRecord(snapshotBody.snapshot);
    const ruleBookVersion = snapshot === null ? null : asNonEmptyString(snapshot.ruleBookVersion);
    const ruleBookMaterial = snapshot === null ? null : asRecord(snapshot.ruleBookMaterial);
    const snapshotPositions = ruleBookMaterial === null ? null : ruleBookMaterial.positions;
    const membersBody = asRecord(await membersResponse.json());
    const rosterBody = asRecord(await rosterResponse.json());
    const rosterMembers = membersBody === null ? null : membersBody.members;
    const staffingPositions = rosterBody === null ? null : rosterBody.positions;
    if (
      snapshot?.v !== 3 ||
      ruleBookVersion === null ||
      !Array.isArray(snapshotPositions) ||
      !Array.isArray(rosterMembers) ||
      !Array.isArray(staffingPositions)
    ) {
      return {
        context: null,
        error:
          'The selected session does not provide a complete immutable operator context. No transition preview is available.',
      };
    }

    return {
      context: {
        sessionId,
        sessionLabel: `Immutable ${ruleBookVersion} Bid snapshot`,
        members: Object.fromEntries(
          rosterMembers.flatMap((member) => {
            const label = membershipLabel(member);
            return label === null ? [] : [label];
          }),
        ),
        bidPositions: Object.fromEntries(
          snapshotPositions.flatMap((position) => {
            const label = bidPositionLabel(position);
            return label === null ? [] : [label];
          }),
        ),
        staffingPositions: Object.fromEntries(
          staffingPositions.flatMap((position) => {
            const label = staffingLabel(position);
            return label === null ? [] : [label];
          }),
        ),
      },
      error: null,
    };
  } catch {
    return {
      context: null,
      error:
        'The selected session’s reviewed operator context could not be loaded. No transition preview is available.',
    };
  }
}

export default async function AwardTransitionPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  await requireAdmin();
  const { session_id: requestedSessionId } = await searchParams;
  const sessionId = validSessionId(requestedSessionId);
  const loaded =
    sessionId === null
      ? {
          context: null,
          error:
            requestedSessionId === undefined
              ? null
              : 'The selected session link is invalid. Return to its session controls and choose the action again.',
        }
      : await loadOperatorContext(sessionId);

  return (
    <AwardTransitionWorkspace operatorContext={loaded.context} selectionError={loaded.error} />
  );
}
