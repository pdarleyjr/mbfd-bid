import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/require-admin';
import { serverWorkerFetch } from '../../../../lib/server-worker-fetch';
import { PublishButton } from './PublishButton';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface RuleBook {
  version: string;
  effectiveYear: number;
  status: 'draft' | 'active' | 'archived';
  notes: string | null;
  publishedAt: number | null;
}

export default async function RuleBookDetailPage({
  params,
}: {
  params: Promise<{ version: string }>;
}) {
  await requireAdmin();
  const { version } = await params;

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

  if (fetchError !== null) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="font-heading text-2xl text-white">
          Rule book <span className="font-mono">{version}</span>
        </h1>
        <div className="mt-6 rounded-lg border border-amber-600 bg-amber-950/30 p-4 text-sm text-amber-200">
          Could not load rule books: {fetchError}.{' '}
          <span className="text-amber-300">
            Check the Worker logs and JWT validity, then reload this page.
          </span>
        </div>
      </div>
    );
  }

  const book = rule_books.find((b) => b.version === version);
  if (book === undefined) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-heading text-2xl text-white">
        Rule book <span className="font-mono">{book.version}</span>
      </h1>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-slate-200">
        <dt className="text-slate-400">Effective year</dt>
        <dd className="tabular-nums">{book.effectiveYear}</dd>
        <dt className="text-slate-400">Status</dt>
        <dd className="capitalize">{book.status}</dd>
        <dt className="text-slate-400">Notes</dt>
        <dd>{book.notes ?? '—'}</dd>
      </dl>

      {book.status === 'draft' && <PublishButton version={book.version} />}
    </div>
  );
}
