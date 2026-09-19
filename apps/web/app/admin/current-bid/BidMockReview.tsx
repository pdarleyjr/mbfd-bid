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
      description="A rehearsal retains its saved Bid version and Department evidence."
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
        variant="primary"
        disabled={locked || stale || dirty || !base.version}
        onClick={() => void reviewMock()}
      >
        {busy ? 'Checking…' : 'Check Mock readiness'}
      </Button>
      {mockPreview && !mockPreview.wouldAllowCreateMock && (
        <div role="alert" className="space-y-2 text-sm">
          <p>Mock creation is blocked: {mockPreview.policyError.replaceAll('_', ' ')}.</p>
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
          href={`/admin/sessions/${encodeURIComponent(createdMock.id)}` as Route}
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
