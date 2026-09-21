'use client';

import { Button } from '@/components/ui/button';
import {
  type BidDefinitionContent,
  type BidProfileReviewResponse,
  BidProfileReviewResponseSchema,
} from '@mbfd/shared';
import { useState } from 'react';
import { type CurrentBid, bidRequest } from './bid-client';

export function BidProfileReview({
  content,
  expected,
  year,
  locked,
}: {
  content: BidDefinitionContent;
  expected: CurrentBid['expected'];
  year: number;
  locked: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ stamp: string; result: BidProfileReviewResponse } | null>(
    null,
  );
  const stamp = JSON.stringify({ content, expected });
  const result = review?.stamp === stamp ? review.result : null;
  const reviewedADayTimingExceptions =
    result?.valid && result.materialized.content.settings?.v === 3
      ? (result.materialized.content.settings.livePolicy.annualOperations?.aDay.execution
          ?.timingExceptions ?? [])
      : [];
  async function preview() {
    setBusy(true);
    setError(null);
    try {
      const result = await bidRequest(year, 'preview', BidProfileReviewResponseSchema, {
        body: { kind: 'profile-review', expected, intent: { operation: 'save', content } },
      });
      setReview({ stamp, result });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Shared rule review unavailable.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Shared rule impact"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <p className="text-sm text-muted-foreground">
        Save applies shared rules automatically. You can review affected positions and candidate
        impact first.
      </p>
      <Button
        type="button"
        disabled={locked || busy || !content.authoring}
        onClick={() => void preview()}
      >
        {busy ? 'Reviewing…' : 'Review shared rule impact'}
      </Button>
      {error && <p role="alert">{error}</p>}
      {result?.kind === 'INVALID_CANDIDATE' && (
        <ul>
          {result.issues.map((issue, index) => (
            <li key={`${index}-${issue.code}`}>
              {issue.path.join(' › ')}: {issue.message}
            </li>
          ))}
        </ul>
      )}
      {result?.kind === 'PROFILE_AUTHORING_UNAVAILABLE' && (
        <p>Add a shared rule to review its impact.</p>
      )}
      {result?.kind === 'PROFILE_COMPILATION_CONFLICT' && (
        <ul>
          {result.conflicts.map((conflict) => (
            <li key={`${conflict.positionId}-${conflict.field}`}>
              {conflict.positionId}: {conflict.reason}
            </li>
          ))}
        </ul>
      )}
      {result?.valid && (
        <>
          <p>{result.summary.affectedPositionCount} opportunities will change.</p>
          {result.summary.impact.status === 'EVALUATED' ? (
            <p>
              Eligibility changes: {result.summary.eligibilityChangeCount}. Score changes:{' '}
              {result.summary.scoringChangeCount}. Ranking changes:{' '}
              {result.summary.relativePriorityChangeCount}.
            </p>
          ) : (
            <p>
              Candidate impact is unavailable until the Bid and Department evidence can be
              evaluated. Position changes are still shown.
            </p>
          )}
          <ul>
            {result.profileMappings.map((profile) => (
              <li key={profile.id}>
                <strong>{profile.name}</strong>: {profile.positionIds.length} opportunities.{' '}
                {profile.positionIds.join(', ')}
              </li>
            ))}
          </ul>
          {reviewedADayTimingExceptions.some((exception) => exception.profileIds.length) ? (
            <section aria-label="Reviewed A-Day timing scopes" className="space-y-1">
              <p className="font-medium">Reviewed A-Day timing scopes</p>
              <ul>
                {reviewedADayTimingExceptions
                  .filter((exception) => exception.profileIds.length)
                  .map((exception) => (
                    <li key={exception.id}>
                      {exception.label}: {exception.positionIds.length} opportunities.{' '}
                      {exception.positionIds.join(', ')}
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}
          <p className="text-sm text-muted-foreground">
            A-Day availability, selections and awards are evaluated during a run.
          </p>
        </>
      )}
    </section>
  );
}
