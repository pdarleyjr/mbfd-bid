import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import type { CredentialRow, RosterMember } from '../_lib/station-info';
import { RosterClient } from './RosterClient';
// Canonical member-credentials extract from the official Bid Credentials PDF
// (235 members, 3,877 cert links). Replaces the older `synthesis.json` which
// only had position-derived inferences.
import memberCredentialsData from './_data/member_credentials.json';

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
  const qsStr = qs.toString();

  let members: RosterMember[] = [];
  let credentials: CredentialRow[] = [];
  let fetchError: string | null = null;

  try {
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
          Computed bid order across both pools. Toggle credential pills to grant or revoke certs;
          changes write a single override_cert audit row each.
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
        synthesisJson={JSON.stringify(memberCredentialsData)}
      />
    </div>
  );
}
