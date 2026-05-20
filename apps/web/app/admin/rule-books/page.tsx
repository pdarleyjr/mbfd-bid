import type { Route } from 'next';
import Link from 'next/link';
import { formatET } from '../../../lib/et-time';
import { requireAdmin } from '../../../lib/require-admin';
import { serverWorkerFetch } from '../../../lib/server-worker-fetch';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface RuleBook {
  version: string;
  effectiveYear: number;
  status: 'draft' | 'active' | 'archived';
  publishedAt: number | null;
}

const statusColors: Record<RuleBook['status'], string> = {
  draft: 'bg-amber-700 text-amber-100',
  active: 'bg-emerald-700 text-emerald-100',
  archived: 'bg-slate-600 text-slate-200',
};

export default async function RuleBooksPage() {
  await requireAdmin();
  let rule_books: RuleBook[] = [];
  let fetchError: string | null = null;
  try {
    const res = await serverWorkerFetch('/api/admin/rule-books');
    if (!res.ok) {
      fetchError = `Worker returned ${res.status}`;
    } else {
      const body = (await res.json()) as { rule_books?: RuleBook[] };
      rule_books = body.rule_books ?? [];
    }
  } catch (e) {
    fetchError = e instanceof Error ? e.message : 'fetch failed';
  }

  return (
    <div>
      <h1 className="font-heading text-2xl text-white">Rule Books</h1>
      <p className="mt-2 text-sm text-slate-300">
        Each year has at most one active book. Drafts can be edited; archived books are immutable.
      </p>
      {fetchError && (
        <div className="mt-6 rounded-lg border border-amber-600 bg-amber-950/30 p-4 text-sm text-amber-200">
          Could not load rule books: {fetchError}.{' '}
          <span className="text-amber-300">
            Check the Worker logs and JWT validity. The page is rendering with an empty list.
          </span>
        </div>
      )}
      {!fetchError && rule_books.length === 0 && (
        <div className="mt-6 rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-300">
          No rule books yet. Use the Worker API or seed script to create one.
        </div>
      )}
      <table className="mt-6 w-full border border-slate-700 text-sm text-slate-200">
        <thead className="bg-slate-800 text-left text-slate-300">
          <tr>
            <th className="p-2">Version</th>
            <th className="p-2">Effective Year</th>
            <th className="p-2">Status</th>
            <th className="p-2">Published</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {rule_books.map((rb) => (
            <tr key={rb.version} className="border-t border-slate-700">
              <td className="p-2 font-mono">{rb.version}</td>
              <td className="p-2 tabular-nums">{rb.effectiveYear}</td>
              <td className="p-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${statusColors[rb.status]}`}
                >
                  {rb.status}
                </span>
              </td>
              <td className="p-2 tabular-nums">
                {rb.publishedAt !== null ? formatET(new Date(rb.publishedAt), 'datetime') : '—'}
              </td>
              <td className="p-2">
                <Link
                  href={`/admin/rule-books/${rb.version}` as Route}
                  className="text-red-400 underline"
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
