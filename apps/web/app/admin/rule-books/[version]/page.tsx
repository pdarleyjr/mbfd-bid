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
        <h1 className="font-heading text-2xl text-foreground">
          Rule book <span className="font-mono">{version}</span>
        </h1>
        <div className="mt-6 rounded-lg border border-warning/40 bg-warning-surface p-4 text-sm text-warning">
          Could not load rule books: {fetchError}.{' '}
          <span className="text-warning">
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
      <h1 className="font-heading text-2xl text-foreground">
        Rule book <span className="font-mono">{book.version}</span>
      </h1>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-foreground">
        <dt className="text-muted-foreground">Effective year</dt>
        <dd className="tabular-nums">{book.effectiveYear}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd className="capitalize">{book.status}</dd>
        <dt className="text-muted-foreground">Notes</dt>
        <dd>{book.notes ?? '—'}</dd>
      </dl>

      <section
        aria-labelledby="policy-coverage-heading"
        className="mt-6 rounded-lg border border-border bg-card p-4"
      >
        <h2 id="policy-coverage-heading" className="font-heading text-lg text-foreground">
          Bid participation coverage
        </h2>
        <p className="mt-1 text-sm text-foreground">
          Read-only rule-book validation. Administrative staffing positions remain in staffing but
          outside ordinary Bid selection.
        </p>

        {coverageFetchError !== null && (
          <p className="mt-3 text-sm text-warning">
            Could not load coverage: {coverageFetchError}. Reload before relying on this review.
          </p>
        )}

        {coverage !== null && (
          <>
            <p
              className={`mt-3 text-sm font-semibold ${
                coverage.valid ? 'text-success' : 'text-warning'
              }`}
            >
              {coverage.valid
                ? 'Complete biddable-position coverage'
                : 'Coverage requires correction'}
            </p>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm text-foreground sm:grid-cols-2">
              <dt className="text-muted-foreground">Expected biddable positions</dt>
              <dd className="tabular-nums">{coverage.expected_biddable_position_ids.length}</dd>
              <dt className="text-muted-foreground">Valid bid rules</dt>
              <dd className="tabular-nums">{coverage.valid_rule_position_ids.length}</dd>
              <dt className="text-muted-foreground">Rule rows</dt>
              <dd className="tabular-nums">{coverage.rule_count}</dd>
              <dt className="text-muted-foreground">Administratively assigned outside Bid</dt>
              <dd className="font-mono text-xs">
                {displayPositionIds(coverage.administratively_assigned_position_ids)}
              </dd>
              <dt className="text-muted-foreground">Missing biddable rules</dt>
              <dd className="font-mono text-xs">
                {displayPositionIds(coverage.missing_biddable_position_ids)}
              </dd>
              <dt className="text-muted-foreground">Non-biddable rules present</dt>
              <dd className="font-mono text-xs">
                {displayPositionIds(coverage.non_biddable_position_ids)}
              </dd>
              <dt className="text-muted-foreground">Duplicate rule positions</dt>
              <dd className="font-mono text-xs">
                {displayPositionIds(coverage.duplicate_position_ids)}
              </dd>
              <dt className="text-muted-foreground">Invalid rule positions</dt>
              <dd className="font-mono text-xs">
                {displayPositionIds(coverage.invalid_position_ids)}
              </dd>
              <dt className="text-muted-foreground">Unexpected rule positions</dt>
              <dd className="font-mono text-xs">
                {displayPositionIds(coverage.unexpected_position_ids)}
              </dd>
              <dt className="text-muted-foreground">Template issues</dt>
              <dd className="font-mono text-xs">
                {displayPositionIds(coverage.template_version_issues)}
              </dd>
            </dl>
            {coverage.legacy_excluded_position_ids.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
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
