'use client';

import { Button } from '@/components/ui/button';
import type { BidLaunchAcknowledgement, BidLaunchReview } from '@mbfd/shared';

/** One deliberate action acknowledges the exact server-reviewed advisory set. */
export function BidLaunchAction({
  review,
  acknowledged = false,
  label,
  advisoryLabel,
  disabled,
  onLaunch,
}: {
  review?: BidLaunchReview | undefined;
  acknowledged?: boolean | undefined;
  label: string;
  advisoryLabel: string;
  disabled: boolean;
  onLaunch(acknowledgement?: BidLaunchAcknowledgement): void;
}) {
  const needsAcknowledgement = review?.requiresAcknowledgement === true && !acknowledged;
  const summary = review?.advisories.flatMap((advisory) => {
    if (advisory.affectedCount === undefined) return [];
    if (advisory.id === 'source_decisions')
      return [`${advisory.affectedCount} open source questions`];
    if (advisory.id === 'qualification_holds')
      return [`${advisory.affectedCount} held credentials`];
    return [];
  });
  return (
    <div className="space-y-3">
      {review && review.advisories.length > 0 && (
        <>
          {summary && summary.length > 0 && (
            <p className="text-sm text-muted-foreground">{summary.join(' · ')}</p>
          )}
          <details className="rounded border border-warning/30 p-3 text-sm">
            <summary className="min-h-11 cursor-pointer content-center font-medium">
              Launch advisories ({review.advisories.length}){acknowledged ? ' · acknowledged' : ''}
            </summary>
            <ul aria-label="Launch advisories" className="mt-2 list-disc space-y-2 pl-5">
              {review.advisories.map((advisory) => (
                <li key={advisory.id}>{advisory.detail}</li>
              ))}
            </ul>
          </details>
        </>
      )}
      {needsAcknowledgement && (
        <p className="text-sm text-muted-foreground">
          Continue with the saved rules. Open questions stay open; held credentials stay excluded.
        </p>
      )}
      <Button
        type="button"
        variant="primary"
        className="min-h-11"
        disabled={disabled}
        onClick={() =>
          onLaunch(needsAcknowledgement ? { advisorySha256: review.advisorySha256 } : undefined)
        }
      >
        {needsAcknowledgement ? advisoryLabel : label}
      </Button>
    </div>
  );
}
