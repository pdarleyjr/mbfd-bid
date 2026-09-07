import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';

import { QualificationReviewWorkspace } from './QualificationReviewWorkspace';

interface BatchesResponse {
  batches: Array<{
    id: string;
    source_system: string;
    source_reference: string;
    status: string;
    total: number;
    needsReview: number;
    applied: number;
  }>;
}

export default async function QualificationReviewsPage() {
  await requireAdmin();
  let batches: BatchesResponse['batches'] = [];
  let error: string | null = null;
  try {
    const response = await serverWorkerFetch('/api/admin/qualification-lifecycle/reviews/batches');
    if (!response.ok) error = `Qualification review service returned ${response.status}.`;
    else batches = ((await response.json()) as BatchesResponse).batches;
  } catch (caught) {
    error =
      caught instanceof Error
        ? caught.message
        : 'Qualification review service could not be reached.';
  }
  return (
    <section className="mx-auto max-w-7xl space-y-6" aria-labelledby="qualification-review-heading">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
          Year-round personnel evidence
        </p>
        <h1
          id="qualification-review-heading"
          className="mt-1 font-heading text-3xl text-foreground"
        >
          Qualification review
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-foreground">
          Stage authoritative evidence, resolve exceptions, and explicitly apply accepted rows
          through the immutable qualification lifecycle.
        </p>
      </header>
      {error !== null ? (
        <div className="rounded-xl border border-warning/40 bg-warning-surface p-5 text-sm text-warning">
          {error} No local fallback or inferred qualification state is shown.
        </div>
      ) : (
        <QualificationReviewWorkspace initialBatches={batches} />
      )}
    </section>
  );
}
