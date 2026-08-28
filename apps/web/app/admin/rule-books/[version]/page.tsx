import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/require-admin';
import { serverWorkerFetch } from '../../../../lib/server-worker-fetch';
import { PublishButton } from './PublishButton';

export const dynamic = 'force-dynamic';

interface RuleBook {
  version: string;
  effectiveYear: number;
  status: 'draft' | 'active' | 'archived';
  notes: string | null;
  publishedAt: number | null;
}

interface RuleBookCoverage {
  valid: boolean;
  rule_count: number;
  expected_biddable_position_ids: string[];
  valid_rule_position_ids: string[];
  administratively_assigned_position_ids: string[];
  legacy_excluded_position_ids: string[];
  invalid_position_ids: string[];
  duplicate_position_ids: string[];
  missing_biddable_position_ids: string[];
  non_biddable_position_ids: string[];
  unexpected_position_ids: string[];
  template_version_issues: string[];
}

function displayPositionIds(positionIds: readonly string[]): string {
  return positionIds.length === 0 ? 'None' : positionIds.join(', ');
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

  let coverage: RuleBookCoverage | null = null;
  let coverageFetchError: string | null = null;
  try {
    const res = await serverWorkerFetch(
      `/api/admin/rule-books/${encodeURIComponent(book.version)}/coverage`,
    );
    if (!res.ok) {
      coverageFetchError = `Worker returned ${res.status}`;
    } else {
      coverage = (await res.json()) as RuleBookCoverage;
    }
  } catch (e) {
    coverageFetchError = e instanceof Error ? e.message : 'fetch failed';
  }

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

      <section
        aria-labelledby="policy-coverage-heading"
        className="mt-6 rounded-lg border border-slate-700 bg-slate-900/60 p-4"
      >
        <h2 id="policy-coverage-heading" className="font-heading text-lg text-white">
          Bid participation coverage
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          Read-only rule-book validation. Administrative staffing positions remain in staffing but
          outside ordinary Bid selection.
        </p>

        {coverageFetchError !== null && (
          <p className="mt-3 text-sm text-amber-200">
            Could not load coverage: {coverageFetchError}. Reload before relying on this review.
          </p>
        )}

        {coverage !== null && (
          <>
            <p
              className={`mt-3 text-sm font-semibold ${
                coverage.valid ? 'text-emerald-300' : 'text-amber-200'
              }`}
            >
              {coverage.valid
                ? 'Complete biddable-position coverage'
                : 'Coverage requires correction'}
            </p>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm text-slate-200 sm:grid-cols-2">
              <dt className="text-slate-400">Expected biddable positions</dt>
              <dd className="tabular-nums">{coverage.expected_biddable_position_ids.length}</dd>
              <dt className="text-slate-400">Valid bid rules</dt>
              <dd className="tabular-nums">{coverage.valid_rule_position_ids.length}</dd>
              <dt className="text-slate-400">Rule rows</dt>
              <dd className="tabular-nums">{coverage.rule_count}</dd>
              <dt className="text-slate-400">Administratively assigned outside Bid</dt>
              <dd className="font-mono text-xs">
                {displayPositionIds(coverage.administratively_assigned_position_ids)}
              </dd>
              <dt className="text-slate-400">Missing biddable rules</dt>
              <dd className="font-mono text-xs">
                {displayPositionIds(coverage.missing_biddable_position_ids)}
              </dd>
              <dt className="text-slate-400">Non-biddable rules present</dt>
              <dd className="font-mono text-xs">
                {displayPositionIds(coverage.non_biddable_position_ids)}
              </dd>
              <dt className="text-slate-400">Duplicate rule positions</dt>
              <dd className="font-mono text-xs">
                {displayPositionIds(coverage.duplicate_position_ids)}
              </dd>
              <dt className="text-slate-400">Invalid rule positions</dt>
              <dd className="font-mono text-xs">
                {displayPositionIds(coverage.invalid_position_ids)}
              </dd>
              <dt className="text-slate-400">Unexpected rule positions</dt>
              <dd className="font-mono text-xs">
                {displayPositionIds(coverage.unexpected_position_ids)}
              </dd>
              <dt className="text-slate-400">Template issues</dt>
              <dd className="font-mono text-xs">
                {displayPositionIds(coverage.template_version_issues)}
              </dd>
            </dl>
            {coverage.legacy_excluded_position_ids.length > 0 && (
              <p className="mt-3 text-xs text-slate-400">
                Separately tracked legacy exclusions:{' '}
                <span className="font-mono">
                  {displayPositionIds(coverage.legacy_excluded_position_ids)}
                </span>
              </p>
            )}
          </>
        )}
      </section>

      {book.status === 'draft' && <PublishButton version={book.version} />}
    </div>
  );
}
