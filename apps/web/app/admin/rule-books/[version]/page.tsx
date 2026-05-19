import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { JWT_COOKIE_NAME } from '../../../../lib/cookies';
import { requireAdmin } from '../../../../lib/require-admin';
import { getWorkerBase } from '../../../../lib/worker-base';
import { PublishButton } from './PublishButton';

export const runtime = 'edge';

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
  const cookieStore = await cookies();
  const jwt = cookieStore.get(JWT_COOKIE_NAME)?.value;
  const baseUrl = getWorkerBase();
  const res = await fetch(`${baseUrl}/api/admin/rule-books`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
    cache: 'no-store',
  });
  const { rule_books } = (await res.json()) as { rule_books: RuleBook[] };
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
