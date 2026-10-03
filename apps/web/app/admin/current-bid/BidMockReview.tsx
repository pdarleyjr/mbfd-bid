'use client';
import { Button } from '@/components/ui/button';
import type { Route } from 'next';
import Link from 'next/link';
import { FieldSection } from './BidFields';
import { BidTermIssues } from './BidTermIssues';
import type { BidMockPreview, BidMockResult, CurrentBid } from './bid-client';
import type { PendingBidWrite } from './bid-draft';

export function BidMockReview({
  base,
  busy,
  locked,
  dirty,
  stale,
  mockPreview,
  createdMock,
  reviewMock,
  execute,
}: {
  base: CurrentBid;
  busy: boolean;
  locked: boolean;
  dirty: boolean;
  stale: boolean;
  mockPreview: BidMockPreview | null;
  createdMock: BidMockResult | null;
  reviewMock(): Promise<void>;
  execute(write: PendingBidWrite): Promise<void>;
}) {
  return (
    <FieldSection
      title="Mock Bid"
      description="Create a fresh rehearsal from the saved Bid. Existing sessions remain available."
    >
      <p className="text-sm">
        {dirty
          ? 'The current draft has unsaved changes.'
          : base.version
            ? `Current saved version: ${base.version.versionNumber}.`
            : 'Save the first Bid version before preparing a managed rehearsal.'}
      </p>
      <Button
        type="button"
        variant={mockPreview?.wouldAllowCreateMock ? 'secondary' : 'primary'}
        disabled={locked || stale || dirty || !base.version}
        onClick={() => void reviewMock()}
      >
        {busy ? 'Checking…' : 'Check Mock readiness'}
      </Button>
      {mockPreview && !mockPreview.wouldAllowCreateMock && (
        <div role="alert" className="space-y-2 text-sm">
          <p>MOCK BLOCKER: {mockPreview.policyError.replaceAll('_', ' ')}.</p>
          {mockPreview.positionIds && mockPreview.positionIds.length > 0 && (
            <p className="break-words">
              Opportunities requiring review: {mockPreview.positionIds.join(', ')}
            </p>
          )}
          {mockPreview.tenureIssues && (
            <ul className="list-disc pl-5">
              {mockPreview.tenureIssues.map((issue) => (
                <li key={`${issue.recordId}:${issue.code}`}>
                  {issue.staffingPositionId}: {issue.code.replaceAll('_', ' ')}
                </li>
              ))}
            </ul>
          )}
          <BidTermIssues issues={mockPreview.termIssues} />
        </div>
      )}
      {mockPreview?.wouldAllowCreateMock &&
        base.version?.id === mockPreview.versionId &&
        base.version.contentSha256 === mockPreview.versionSha256 && (
          <div className="space-y-3 rounded border border-border p-4">
            <h3 className="font-semibold">
              Version {mockPreview.versionNumber} is ready for a Mock Bid
            </h3>
            <p className="text-sm">
              {mockPreview.pool.officerPoolCount} officers · {mockPreview.pool.firefighterPoolCount}{' '}
              firefighters · {mockPreview.pool.excludedCount} excluded
            </p>
            {mockPreview.sourceDecisionBlockers.length > 0 ? (
              <details className="border border-warning/30 p-3 text-sm">
                <summary className="cursor-pointer font-medium">
                  {mockPreview.sourceDecisionBlockers.length} reviews remain before the Real Bid
                </summary>
                <p className="mt-1 text-muted-foreground">
                  This rehearsal preserves those open questions as visible assumptions. They still
                  block creation of a Real Bid.
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {mockPreview.sourceDecisionBlockers.map((item) => (
                    <li key={item.issueId}>
                      {base.content.sourceDecisions.find(
                        (decision) => decision.issueId === item.issueId,
                      )?.title ?? 'Reviewed information is still required before the Real Bid.'}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <p className="text-sm">
              Create a rehearsal with this saved version and the reviewed Department evidence. It
              will keep that version if the Current Bid is edited later.
            </p>
            <Button
              type="button"
              variant="primary"
              disabled={locked || stale || dirty}
              onClick={() =>
                void execute({
                  path: 'mock-sessions',
                  key: crypto.randomUUID(),
                  body: {
                    versionId: mockPreview.versionId,
                    versionSha256: mockPreview.versionSha256,
                    expectedContextSha256: mockPreview.contextSha256,
                    expectedSourceToken: mockPreview.runtimeSourceToken,
                  },
                })
              }
            >
              Create Mock Bid from Version {mockPreview.versionNumber}
            </Button>
          </div>
        )}
      {createdMock && (
        <Link
          href={`/admin/bid?session_id=${encodeURIComponent(createdMock.id)}` as Route}
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          Open created Mock Bid · Version {createdMock.bidDefinition.versionNumber}
        </Link>
      )}
      <Link href="/admin/rehearsal" className="inline-flex min-h-11 items-center text-sm underline">
        Open existing Mock runs
      </Link>
    </FieldSection>
  );
}
