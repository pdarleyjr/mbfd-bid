'use client';
import { Button } from '@/components/ui/button';
import { FieldSection } from './BidFields';
import type { BidVersion, CurrentBid, HistoricalBid } from './bid-client';
import type { PendingBidWrite } from './bid-draft';

type SavedParticipantSelector = NonNullable<
  NonNullable<HistoricalBid['content']['policy']>['stageParticipantSources']
>[number];

function savedParticipantSelectorStageLabel(
  historical: HistoricalBid,
  selector: SavedParticipantSelector,
): string {
  const stage = historical.content.policy?.executionPolicy.stages.find(
    (candidate) => candidate.id === selector.stageId,
  );
  return stage ? `${stage.label} (${stage.id})` : `Saved stage ${selector.stageId}`;
}

function savedParticipantSelectorSourceSummary(selector: SavedParticipantSelector): string {
  const source = selector.participantSource;
  return source.type === 'FILTER'
    ? `FILTER · ${source.active ? 'Active BIDDABLE ranks' : 'Saved filter ranks'}: ${source.ranks.join(', ')}.`
    : `EXPLICIT_MEMBERS · Saved selector member references: ${source.memberIds.join(', ')}.`;
}

function savedParticipantSelectorOrderingSummary(selector: SavedParticipantSelector): string {
  return selector.ordering.map((rule) => `${rule.key} ${rule.direction}`).join(' → ');
}

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
  browseVersions,
  selectVersion,
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
  browseVersions(older?: boolean): Promise<void>;
  selectVersion(version: BidVersion): Promise<void>;
  execute(write: PendingBidWrite): Promise<void>;
}) {
  const selectedIsCurrent = historical?.version.id === base.version?.id;
  const participantSources = historical?.content.policy?.stageParticipantSources ?? [];
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <FieldSection
        title="Version history"
        description="Earlier versions stay in History and can be restored."
      >
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
            {participantSources.length > 0 && (
              <details>
                <summary className="min-h-11 content-center cursor-pointer">
                  Saved participant selector authoring ({participantSources.length})
                </summary>
                <p className="text-sm">
                  Saved selector authoring only. This is not a resolved roster. A pinned server
                  evaluation is required before participant resolution.
                </p>
                <ul className="space-y-3 text-sm">
                  {participantSources.map((selector) => (
                    <li key={selector.stageId}>
                      <strong>{savedParticipantSelectorStageLabel(historical, selector)}</strong>
                      <dl className="mt-1 space-y-1 break-words text-xs">
                        <dt>Saved source reference</dt>
                        <dd>{selector.sourceRef}</dd>
                        <dt>Saved selector</dt>
                        <dd>{savedParticipantSelectorSourceSummary(selector)}</dd>
                        <dt>Saved ordering</dt>
                        <dd>Ordering: {savedParticipantSelectorOrderingSummary(selector)}.</dd>
                      </dl>
                    </li>
                  ))}
                </ul>
              </details>
            )}
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
            {selectedIsCurrent ? (
              <p className="text-sm">This is the current saved Bid version.</p>
            ) : (
              <>
                {dirty && (
                  <p className="text-sm">
                    Save or discard your edits before restoring this version.
                  </p>
                )}
                <p className="text-sm">
                  Restore these settings as the current Bid. Your current settings will remain in
                  History, so you can return to them later.
                </p>
                <Button
                  type="button"
                  variant="primary"
                  disabled={locked || dirty || stale}
                  onClick={() =>
                    void execute({
                      path: 'restore',
                      key: crypto.randomUUID(),
                      body: {
                        expected: base.expected,
                        versionId: historical.version.id,
                        reason: `Restored Bid version ${historical.version.versionNumber}.`,
                      },
                    })
                  }
                >
                  Restore this version
                </Button>
              </>
            )}
          </FieldSection>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            Select an earlier version to view or restore its settings.
          </p>
        )}
      </div>
    </div>
  );
}
