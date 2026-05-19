import type { Route } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { JWT_COOKIE_NAME } from '../../../lib/cookies';
import { formatET } from '../../../lib/et-time';
import { requireAdmin } from '../../../lib/require-admin';
import { getWorkerBase } from '../../../lib/worker-base';

export const runtime = 'edge';

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
  const cookieStore = await cookies();
  const jwt = cookieStore.get(JWT_COOKIE_NAME)?.value;
  const baseUrl = getWorkerBase();
  const res = await fetch(`${baseUrl}/api/admin/rule-books`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
    cache: 'no-store',
  });
  const { rule_books } = (await res.json()) as { rule_books: RuleBook[] };

  return (
    <div>
      <h1 className="font-heading text-2xl text-white">Rule Books</h1>
      <p className="mt-2 text-sm text-slate-300">
        Each year has at most one active book. Drafts can be edited; archived books are immutable.
      </p>
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
