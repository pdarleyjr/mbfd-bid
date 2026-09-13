'use client';
import { Button } from '@/components/ui/button';
import { BidChangeReview } from './BidChangeReview';
import { FieldSection, TextField } from './BidFields';
import type { BidPreview, BidVersion, CurrentBid, HistoricalBid } from './bid-client';
import type { PendingBidWrite } from './bid-draft';

export function BidVersionHistory({
  base,
  versions,
  versionsLoaded,
  nextVersion,
  historical,
  busy,
  locked,
  dirty,
  stale,
  restorePreview,
  restoreReason,
  setRestoreReason,
  browseVersions,
  selectVersion,
  reviewRestore,
  execute,
}: {
  base: CurrentBid;
  versions: BidVersion[];
  versionsLoaded: boolean;
  nextVersion: number | null;
  historical: HistoricalBid | null;
  busy: boolean;
  locked: boolean;
  dirty: boolean;
  stale: boolean;
  restorePreview: BidPreview | null;
  restoreReason: string;
  setRestoreReason(value: string): void;
  browseVersions(older?: boolean): Promise<void>;
  selectVersion(version: BidVersion): Promise<void>;
  reviewRestore(): Promise<void>;
  execute(write: PendingBidWrite): Promise<void>;
}) {
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <FieldSection title="Version history" description="Every saved version is immutable.">
        <div className="space-y-2">
          {versions.map((version) => (
            <Button
              type="button"
              key={version.id}
              className="w-full justify-start text-left"
              aria-pressed={historical?.version.id === version.id}
              disabled={busy}
              onClick={() => void selectVersion(version)}
            >
              <span className="min-w-0 break-words">
                <strong className="block">Version {version.versionNumber}</strong>
                <span className="block text-xs font-normal">
                  {new Date(version.createdAtMs).toLocaleString()}
                </span>
                <span className="mt-1 block text-sm font-normal">{version.reason}</span>
              </span>
            </Button>
          ))}
        </div>
        {versionsLoaded && !versions.length && <p>No saved versions yet.</p>}
        {!versionsLoaded && (
          <Button type="button" disabled={busy} onClick={() => void browseVersions()}>
            Load versions
          </Button>
        )}
        {nextVersion !== null && (
          <Button type="button" disabled={busy} onClick={() => void browseVersions(true)}>
            Load older versions
          </Button>
        )}
      </FieldSection>
      <div className="min-w-0 space-y-4">
        {historical ? (
          <FieldSection
            title={`Version ${historical.version.versionNumber}`}
            description={historical.version.reason}
          >
            <p className="text-sm">
              Saved by {historical.version.actorSubject} ·{' '}
              {new Date(historical.version.createdAtMs).toLocaleString()}
            </p>
            <p className="text-sm">
              {historical.stats.opportunityCount} opportunities · {historical.stats.ruleCount} rules
            </p>
            <details>
              <summary className="min-h-11 content-center cursor-pointer">Source language</summary>
              <p className="whitespace-pre-wrap break-words text-sm">
                {historical.content.policy?.policyText ?? 'No policy language attached.'}
              </p>
            </details>
            <details>
              <summary className="min-h-11 content-center cursor-pointer">
                Opportunities ({historical.content.positions.length})
              </summary>
              <ul className="space-y-2 text-sm">
                {historical.content.positions.map((p) => (
                  <li key={p.id}>
                    {p.positionName} · {p.shift} · {p.station} · {p.unit} · {p.id}
                  </li>
                ))}
              </ul>
            </details>
            <details>
              <summary className="min-h-11 content-center cursor-pointer">
                Version provenance
              </summary>
              <dl className="space-y-2 break-all text-xs">
                <dt>Version identifier</dt>
                <dd>{historical.version.id}</dd>
                <dt>Content SHA-256</dt>
                <dd>{historical.version.contentSha256}</dd>
                <dt>Previous version</dt>
                <dd>{historical.version.predecessorId ?? 'First version'}</dd>
                <dt>Restored from</dt>
                <dd>{historical.version.restoredFromId ?? 'Direct edit'}</dd>
              </dl>
            </details>
            {dirty && (
              <p className="text-sm">Save or discard your edits before reviewing a restore.</p>
            )}
            <Button
              type="button"
              disabled={locked || dirty || stale}
              onClick={() => void reviewRestore()}
            >
              Review restore
            </Button>
            {restorePreview && (
              <>
                <BidChangeReview preview={restorePreview} />
                {restorePreview.valid && (
                  <div className="space-y-3">
                    <p className="text-sm">
                      Restoring Version {historical.version.versionNumber} creates a new current
                      version. All existing versions and run snapshots remain preserved.
                    </p>
                    <TextField
                      label="Restore reason"
                      value={restoreReason}
                      onChange={setRestoreReason}
                    />
                    <Button
                      type="button"
                      variant="primary"
                      disabled={locked || dirty || stale || restoreReason.trim().length < 4}
                      onClick={() =>
                        void execute({
                          path: 'restore',
                          key: crypto.randomUUID(),
                          body: {
                            expected: base.expected,
                            versionId: historical.version.id,
                            reason: restoreReason,
                          },
                        })
                      }
                    >
                      Restore as new current version
                    </Button>
                  </div>
                )}
              </>
            )}
          </FieldSection>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            Select a version to inspect its saved content and review a restore.
          </p>
        )}
      </div>
    </div>
  );
}
