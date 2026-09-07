import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
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
  CIVILIAN: 'bg-success-surface text-success',
  FF: 'bg-muted text-foreground',
  LT: 'bg-info-surface text-info',
  CPT: 'bg-warning text-primary-foreground',
  DC: 'bg-purple-700 text-purple-50',
  DEP_CHIEF: 'bg-purple-800 text-purple-50',
  CHIEF: 'bg-destructive text-primary-foreground',
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
    fetchError = err instanceof Error ? err.message : 'Failed to load legacy filter results.';
  }

  return (
    <div>
      <nav className="mb-4 text-sm text-muted-foreground">
        <Link href="/admin/members/roster" className="hover:text-destructive">
          Master Roster
        </Link>
        <span className="mx-2">/</span>
        <span>{stationTitle(station)}</span>
      </nav>

      <h1 className="font-heading text-2xl text-foreground">{stationTitle(station)}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{stationRuleText(station)}</p>
      {fetchError ? (
        <p className="mt-2 text-sm text-destructive">{fetchError}</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {members.length} matching member{members.length !== 1 ? 's' : ''}.
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <Table className="w-full border-collapse text-sm">
          <caption className="sr-only">{stationTitle(station)} legacy filter results</caption>
          <TableHeader className="bg-card">
            <TableRow>
              <TableHead className="px-3 py-2 text-left font-medium text-foreground">#</TableHead>
              <TableHead className="px-3 py-2 text-left font-medium text-foreground">
                Emp ID
              </TableHead>
              <TableHead className="px-3 py-2 text-left font-medium text-foreground">
                Name
              </TableHead>
              <TableHead className="px-3 py-2 text-left font-medium text-foreground">
                Rank
              </TableHead>
              <TableHead className="px-3 py-2 text-left font-medium text-foreground">RSC</TableHead>
              <TableHead className="px-3 py-2 text-left font-medium text-foreground">
                Rank Sen.
              </TableHead>
              <TableHead className="px-3 py-2 text-left font-medium text-foreground">
                Credentials
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow
                key={m.id}
                className="border-border border-t transition-colors hover:bg-card"
              >
                <TableCell className="px-3 py-2 align-top font-mono text-xs text-foreground [font-variant-numeric:tabular-nums]">
                  {m.ordinal}
                </TableCell>
                <TableCell className="px-3 py-2 align-top font-mono text-xs text-foreground [font-variant-numeric:tabular-nums]">
                  {m.employee_id}
                </TableCell>
                <TableCell className="px-3 py-2 align-top">
                  <span className="font-medium text-foreground">{m.last_name}</span>
                  <span className="text-muted-foreground">, {m.first_name}</span>
                </TableCell>
                <TableCell className="px-3 py-2 align-top">
                  <span
                    className={[
                      'inline-flex rounded px-2 py-0.5 text-xs font-semibold',
                      RANK_PILL_CLASS[m.rank],
                    ].join(' ')}
                  >
                    {m.rank}
                  </span>
                </TableCell>
                <TableCell className="px-3 py-2 align-top font-mono text-xs text-foreground [font-variant-numeric:tabular-nums]">
                  {m.rsc_seniority}
                </TableCell>
                <TableCell className="px-3 py-2 align-top font-mono text-xs text-foreground [font-variant-numeric:tabular-nums]">
                  {m.rank_seniority ?? '—'}
                </TableCell>
                <TableCell className="px-3 py-2 align-top">
                  <EligiblePillCluster heldIds={m.credential_ids} credentials={credentials} />
                </TableCell>
              </TableRow>
            ))}
            {members.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No members currently meet this station&rsquo;s eligibility rule.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
