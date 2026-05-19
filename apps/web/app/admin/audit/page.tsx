import { cookies } from 'next/headers';
import { cfEnv } from '../../../lib/cf-env';
import { JWT_COOKIE_NAME } from '../../../lib/cookies';
import { formatET } from '../../../lib/et-time';
import { requireAdmin } from '../../../lib/require-admin';

export const runtime = 'edge';

interface AuditEntry {
  id: string;
  seq: number;
  bidSessionId: string | null;
  actorType: 'member' | 'admin' | 'system' | 'ai';
  actorId: number | null;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  reason: string | null;
  createdAt: number;
}

const AUDIT_ACTIONS = [
  'pick',
  'forced_pick',
  'pause',
  'resume',
  'skip',
  'override_rule',
  'override_cert',
  'lock_position',
  'unlock_position',
  'grant_extension',
  'admin_bid_for_member',
  'session_start',
  'session_complete',
  'members_import',
  'credentials_import',
  'positions_clone',
  'rule_book_clone',
] as const;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const cookieStore = await cookies();
  const jwt = cookieStore.get(JWT_COOKIE_NAME)?.value;
  const baseUrl = cfEnv('WORKER_URL') ?? 'http://localhost:8787';

  const qs = new URLSearchParams();
  qs.set('limit', '100');
  if (sp.action !== undefined && sp.action !== '') qs.set('action', sp.action);
  if (sp.from !== undefined && sp.from !== '') qs.set('from', sp.from);
  if (sp.to !== undefined && sp.to !== '') qs.set('to', sp.to);

  const res = await fetch(`${baseUrl}/api/admin/audit?${qs.toString()}`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
    cache: 'no-store',
  });
  const { entries, total } = (await res.json()) as { entries: AuditEntry[]; total: number };

  const exportQs = new URLSearchParams(qs);
  exportQs.set('format', 'csv');
  exportQs.delete('limit');

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="font-heading text-2xl text-white">Audit Log</h1>
        <a
          href={`/api/admin/audit/export?${exportQs.toString()}`}
          className="rounded border border-slate-600 px-3 py-1 text-sm text-slate-200 hover:border-slate-400"
        >
          Export CSV
        </a>
      </div>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs text-slate-400">Action</span>
          <select
            name="action"
            defaultValue={sp.action ?? ''}
            className="mt-1 rounded bg-slate-800 px-3 py-1.5 text-sm text-white"
          >
            <option value="">All</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-slate-400">From (ISO)</span>
          <input
            type="datetime-local"
            name="from"
            defaultValue={sp.from ?? ''}
            className="mt-1 rounded bg-slate-800 px-3 py-1.5 text-sm text-white"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-slate-400">To (ISO)</span>
          <input
            type="datetime-local"
            name="to"
            defaultValue={sp.to ?? ''}
            className="mt-1 rounded bg-slate-800 px-3 py-1.5 text-sm text-white"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-red-700 px-3 py-1.5 text-sm text-white hover:bg-red-600"
        >
          Filter
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-400">
        Showing {entries.length} of {total} matches.
      </p>

      <table className="mt-4 w-full border border-slate-700 text-xs text-slate-200">
        <thead className="bg-slate-800 text-left text-slate-300">
          <tr>
            <th className="p-2">When (ET)</th>
            <th className="p-2">Seq</th>
            <th className="p-2">Actor</th>
            <th className="p-2">Action</th>
            <th className="p-2">Target</th>
            <th className="p-2">Reason</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-slate-700">
              <td className="p-2 tabular-nums">{formatET(new Date(e.createdAt), 'datetime')}</td>
              <td className="p-2 tabular-nums">{e.seq}</td>
              <td className="p-2">
                {e.actorType}
                {e.actorId !== null ? ` #${e.actorId}` : ''}
              </td>
              <td className="p-2 font-mono">{e.action}</td>
              <td className="p-2">
                {e.targetKind !== null ? `${e.targetKind}:${e.targetId ?? ''}` : '—'}
              </td>
              <td className="p-2">{e.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
