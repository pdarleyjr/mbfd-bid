import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  type CredentialRow,
  type RosterMember,
  STATIONS,
  type Station,
  stationRuleText,
  stationTitle,
} from '../../_lib/station-info';
import { EligiblePillCluster } from './EligiblePillCluster';

export const dynamic = 'force-dynamic';

// Note: Next 15 disallows combining `runtime = 'edge'` with `generateStaticParams`,
// and these pages are gated by requireAdmin() so static pre-rendering isn't
// useful anyway. The 6 valid station slugs are enforced by the STATIONS guard
// below — anything else falls through to notFound().

interface PageProps {
  params: Promise<{ station: string }>;
}

interface EligibleResponse {
  members: RosterMember[];
  total: number;
  station: Station;
  title: string;
  rule: string;
}

interface CredentialsResponse {
  credentials: CredentialRow[];
}

const RANK_PILL_CLASS: Record<RosterMember['rank'], string> = {
  CIVILIAN: 'bg-emerald-900 text-emerald-100',
  FF: 'bg-stone-700 text-stone-100',
  LT: 'bg-blue-700 text-blue-50',
  CPT: 'bg-amber-700 text-amber-50',
  DC: 'bg-purple-700 text-purple-50',
  DEP_CHIEF: 'bg-purple-800 text-purple-50',
  CHIEF: 'bg-red-800 text-red-50',
};

export default async function EligibleStationPage({ params }: PageProps) {
  await requireAdmin();

  const { station: stationParam } = await params;
  if (!STATIONS.includes(stationParam as Station)) {
    notFound();
  }
  const station = stationParam as Station;

  let members: RosterMember[] = [];
  let credentials: CredentialRow[] = [];
  let fetchError: string | null = null;

  try {
    const [eligibleRes, credsRes] = await Promise.all([
      serverWorkerFetch(`/api/admin/members/eligible-for/${station}`),
      serverWorkerFetch('/api/admin/credentials?limit=500'),
    ]);
    if (!eligibleRes.ok) {
      const errBody = (await eligibleRes.json().catch(() => null)) as {
        error?: string;
        detail?: string;
      } | null;
      const tag = errBody?.detail ?? errBody?.error ?? '';
      fetchError = `Eligibility fetch failed: ${eligibleRes.status}${tag ? ` — ${tag}` : ''}`;
    } else {
      const body = (await eligibleRes.json()) as EligibleResponse;
      members = body.members;
    }
    if (credsRes.ok) {
      const body = (await credsRes.json()) as CredentialsResponse;
      credentials = body.credentials;
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Failed to load eligibility list.';
  }

  return (
    <div>
      <nav className="mb-4 text-sm text-slate-400">
        <Link href="/admin/members/roster" className="hover:text-red-400">
          Master Roster
        </Link>
        <span className="mx-2">/</span>
        <span>{stationTitle(station)}</span>
      </nav>

      <h1 className="font-heading text-2xl text-white">{stationTitle(station)}</h1>
      <p className="mt-1 text-sm text-slate-400">{stationRuleText(station)}</p>
      {fetchError ? (
        <p className="mt-2 text-sm text-red-400">{fetchError}</p>
      ) : (
        <p className="mt-2 text-sm text-slate-400">
          {members.length} eligible member{members.length !== 1 ? 's' : ''}.
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{stationTitle(station)} eligibility list</caption>
          <thead className="bg-slate-900">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-300">#</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">Emp ID</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">Name</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">Rank</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">RSC</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">Rank Sen.</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">Credentials</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr
                key={m.id}
                className="border-slate-800 border-t transition-colors hover:bg-slate-900/40"
              >
                <td className="px-3 py-2 align-top font-mono text-xs text-slate-300 [font-variant-numeric:tabular-nums]">
                  {m.ordinal}
                </td>
                <td className="px-3 py-2 align-top font-mono text-xs text-slate-300 [font-variant-numeric:tabular-nums]">
                  {m.employee_id}
                </td>
                <td className="px-3 py-2 align-top">
                  <span className="font-medium text-white">{m.last_name}</span>
                  <span className="text-slate-400">, {m.first_name}</span>
                </td>
                <td className="px-3 py-2 align-top">
                  <span
                    className={[
                      'inline-flex rounded px-2 py-0.5 text-xs font-semibold',
                      RANK_PILL_CLASS[m.rank],
                    ].join(' ')}
                  >
                    {m.rank}
                  </span>
                </td>
                <td className="px-3 py-2 align-top font-mono text-xs text-slate-300 [font-variant-numeric:tabular-nums]">
                  {m.rsc_seniority}
                </td>
                <td className="px-3 py-2 align-top font-mono text-xs text-slate-300 [font-variant-numeric:tabular-nums]">
                  {m.rank_seniority ?? '—'}
                </td>
                <td className="px-3 py-2 align-top">
                  <EligiblePillCluster heldIds={m.credential_ids} credentials={credentials} />
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  No members currently meet this station&rsquo;s eligibility rule.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
