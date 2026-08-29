import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import type { CredentialRow, RosterMember } from '../_lib/station-info';
import { type BidOrderSessionContext, RosterClient } from './RosterClient';

export const dynamic = 'force-dynamic';

interface SearchParams {
  search?: string;
  rank?: string;
}

interface RosterResponse {
  members: RosterMember[];
  total: number;
}

interface CredentialsResponse {
  credentials: CredentialRow[];
  total: number;
}

interface ActiveBidSession {
  id: string;
  bidYear: number;
  isMock: boolean;
  currentPhase: string;
}

function activeBidOrderContext(value: unknown): BidOrderSessionContext | null {
  if (typeof value !== 'object' || value === null) return null;
  const session = value as Partial<ActiveBidSession>;
  if (
    typeof session.id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(session.id) ||
    !Number.isSafeInteger(session.bidYear) ||
    typeof session.isMock !== 'boolean' ||
    typeof session.currentPhase !== 'string'
  ) {
    return null;
  }
  const mode = session.isMock ? 'rehearsal Bid' : 'Bid';
  return {
    sessionId: session.id,
    label: `${session.bidYear} ${mode} · ${session.currentPhase.replaceAll('_', ' ')}`,
  };
}

export default async function MasterRosterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();

  const sp = await searchParams;

  const qs = new URLSearchParams();
  if (sp.search) qs.set('search', sp.search);
  if (sp.rank) qs.set('rank', sp.rank);

  let members: RosterMember[] = [];
  let credentials: CredentialRow[] = [];
  let fetchError: string | null = null;
  let bidOrderSession: BidOrderSessionContext | null = null;

  try {
    const activeResponse = await serverWorkerFetch('/api/admin/bid-session/active');
    if (activeResponse.ok) {
      const body = (await activeResponse.json()) as { session?: unknown };
      bidOrderSession = activeBidOrderContext(body.session ?? null);
    }
    if (bidOrderSession !== null) qs.set('session_id', bidOrderSession.sessionId);
    const qsStr = qs.toString();
    const [rosterRes, credsRes] = await Promise.all([
      serverWorkerFetch(`/api/admin/members/roster${qsStr ? `?${qsStr}` : ''}`),
      serverWorkerFetch('/api/admin/credentials?limit=500'),
    ]);
    if (!rosterRes.ok) {
      const errBody = (await rosterRes.json().catch(() => null)) as {
        error?: string;
        detail?: string;
      } | null;
      const tag = errBody?.detail ?? errBody?.error ?? '';
      fetchError = `Roster fetch failed: ${rosterRes.status}${tag ? ` — ${tag}` : ''}`;
    } else {
      const body = (await rosterRes.json()) as RosterResponse;
      members = body.members;
    }
    if (credsRes.ok) {
      const body = (await credsRes.json()) as CredentialsResponse;
      credentials = body.credentials;
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Failed to load roster.';
  }

  return (
    <div>
      <div>
        <h1 className="font-heading text-2xl text-white">Master Roster</h1>
        <p className="mt-1 text-sm text-slate-400">
          Computed bid order across both pools. Credentials are read-only evidence; official
          staffing reconciliation and effective-dated personnel changes use their controlled
          workflows.
        </p>
        {fetchError ? (
          <p className="mt-2 text-sm text-red-400">{fetchError}</p>
        ) : (
          <p className="mt-2 text-sm text-slate-400">
            {members.length} member{members.length !== 1 ? 's' : ''} ranked.
          </p>
        )}
      </div>

      <RosterClient
        initialMembers={members}
        credentials={credentials}
        initialSearch={sp.search ?? ''}
        bidOrderSession={bidOrderSession}
      />
    </div>
  );
}
