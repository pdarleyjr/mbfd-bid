'use client';
import type { BidPreview } from './bid-client';

export function BidChangeReview({ preview }: { preview: BidPreview }) {
  if (!preview.valid)
    return (
      <div role="alert" className="space-y-3">
        <h3 className="font-semibold">Resolve these items before saving</h3>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {preview.issues.map((issue, i) => (
            <li key={`${issue.code}:${i}`}>
              {issue.message}{' '}
              <span className="text-muted-foreground">({issue.path.join(' › ')})</span>
            </li>
          ))}
        </ul>
      </div>
    );
  const labels = {
    positions: 'Opportunities',
    rules: 'Requirements and points',
    participation: 'Participation',
    staffingBindings: 'Department connections',
    sourceDecisions: 'Source decisions',
  };
  return (
    <div className="space-y-4">
      <output className="block font-semibold">
        {preview.wouldCreateVersion
          ? 'This proposal would create a new Bid version.'
          : 'No semantic policy changes.'}
      </output>
      <p className="text-sm">
        {preview.stats.opportunityCount} opportunities · {preview.stats.biddableCount} biddable ·{' '}
        {preview.stats.missingRuleCount} missing rules
      </p>
      {preview.diff.changedSections.length > 0 && (
        <p className="text-sm">
          Changed sections:{' '}
          {preview.diff.changedSections
            .map(
              (s) =>
                ({
                  settings: 'Operating policy and timing',
                  notes: 'Notes',
                  policy: 'Source language',
                  planning: 'Planning dates and source',
                  authoring: 'Rule authoring provenance',
                })[s] ?? s,
            )
            .join(', ')}
        </p>
      )}
      {(Object.keys(labels) as (keyof typeof labels)[]).map((section) => {
        const changes = preview.diff[section];
        return (
          <details key={section} className="rounded border border-border p-3">
            <summary className="min-h-11 content-center cursor-pointer text-sm">
              {labels[section]} · {changes.addedIds.length} added · {changes.changedIds.length}{' '}
              changed · {changes.removedIds.length} removed
            </summary>
            {(['addedIds', 'changedIds', 'removedIds'] as const).map(
              (kind) =>
                changes[kind].length > 0 && (
                  <div key={kind} className="mt-2">
                    <strong className="text-sm">
                      {{ addedIds: 'Added', changedIds: 'Changed', removedIds: 'Removed' }[kind]}
                    </strong>
                    <ul className="list-disc break-words pl-5 text-sm">
                      {changes[kind].map((id) => (
                        <li key={id}>{id}</li>
                      ))}
                    </ul>
                  </div>
                ),
            )}
          </details>
        );
      })}
      {!preview.coverage.valid && (
        <p role="alert" className="text-sm">
          Rule coverage needs review before a run can be created.
        </p>
      )}
    </div>
  );
}
