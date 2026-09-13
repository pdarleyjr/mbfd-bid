'use client';

import { Button } from '@/components/ui/button';
import { useRef, useState } from 'react';
import { FieldSection } from './BidFields';
import {
  type BidLivePreview,
  BidLivePreviewSchema,
  BidRequestError,
  type BidVersion,
  type CurrentBid,
  bidRequest,
} from './bid-client';

const words = (value: string) => value.toLowerCase().replaceAll('_', ' ');

function immutableCurrentVersion(base: CurrentBid): BidVersion | null {
  const version = base.version;
  if (
    base.state !== 'VERSIONED' ||
    !version ||
    base.expected.kind !== 'version' ||
    base.expected.versionId !== version.id ||
    base.expected.revision !== version.versionNumber ||
    base.expected.sha256 !== version.contentSha256
  )
    return null;
  return version;
}

function message(error: unknown) {
  return error instanceof BidRequestError
    ? error.message
    : error instanceof Error
      ? error.message
      : 'The Managed Live preflight could not be completed.';
}

function PolicyBlock({ result }: { result: Extract<BidLivePreview, { policyError: string }> }) {
  return (
    <div role="alert" className="space-y-2 rounded border border-warning p-4 text-sm">
      <p>
        Live policy preparation is blocked: <code>{result.policyError}</code>.
      </p>
      {result.positionIds && result.positionIds.length > 0 && (
        <p className="break-words">
          Opportunities requiring review: {result.positionIds.join(', ')}
        </p>
      )}
      {result.tenureIssues && result.tenureIssues.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {result.tenureIssues.map((issue) => (
            <li key={`${issue.recordId}:${issue.code}`}>
              {issue.staffingPositionId}: {words(issue.code)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReadinessReview({ result }: { result: Exclude<BidLivePreview, { policyError: string }> }) {
  const checks = result.readiness.checks;
  const isBlocked = !result.wouldAllowCreateLive;
  return (
    <div
      {...(isBlocked ? { role: 'alert' as const } : { role: 'status' as const })}
      className="space-y-3 rounded border border-border p-4 text-sm"
    >
      <p>Server Live readiness: {words(result.readiness.overallStatus)}.</p>
      {isBlocked ? (
        <p>Live readiness is blocked by the server.</p>
      ) : (
        <p>The server reports that this saved version currently meets its Live readiness checks.</p>
      )}
      {checks.length > 0 && (
        <ul aria-label="Live readiness checks" className="list-disc space-y-1 pl-5">
          {checks.map((check) => (
            <li key={check.id}>
              {words(check.status)} — {words(check.id)} (<code>{check.id}</code>)
              {check.detail ? `: ${check.detail}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type BidLiveReviewProps = {
  base: CurrentBid;
  year: number;
  busy: boolean;
  locked: boolean;
  dirty: boolean;
  stale: boolean;
  /** Uses the workspace's shared busy gate so a step-up request cannot race another action. */
  begin(): boolean;
  finish(): void;
};

/**
 * Displays a server-authoritative, read-only Managed Live preflight. It has
 * no activation or session-creation affordance; Live execution remains
 * separately guarded by the managed console and server policy.
 */
export function BidLiveReview({
  base,
  year,
  busy,
  locked,
  dirty,
  stale,
  begin,
  finish,
}: BidLiveReviewProps) {
  const version = immutableCurrentVersion(base);
  const sourceStamp = version
    ? `${version.id}:${version.versionNumber}:${version.contentSha256}`
    : null;
  const [result, setResult] = useState<BidLivePreview | null>(null);
  const [resultStamp, setResultStamp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const reviewed = resultStamp === sourceStamp ? result : null;

  async function review() {
    if (!version || !begin()) return;
    const sequence = ++requestSequence.current;
    const stamp = sourceStamp;
    setError(null);
    setResult(null);
    setResultStamp(null);
    try {
      const next = await bidRequest(year, 'preview', BidLivePreviewSchema, {
        body: { kind: 'live', versionId: version.id, versionSha256: version.contentSha256 },
      });
      if (sequence !== requestSequence.current) return;
      if (
        'versionId' in next &&
        (next.versionId !== version.id ||
          next.versionSha256 !== version.contentSha256 ||
          next.versionNumber !== version.versionNumber)
      )
        throw new BidRequestError('invalid_server_response', 200, false);
      setResult(next);
      setResultStamp(stamp);
    } catch (caught) {
      if (sequence !== requestSequence.current) return;
      setError(message(caught));
    } finally {
      finish();
    }
  }

  const unavailable = !version;
  return (
    <FieldSection
      title="Managed Live preflight"
      description="Review the immutable current saved version against server policy and readiness. This check has no activation authority."
    >
      <p className="text-sm">
        {base.version === null
          ? 'No saved Bid version exists. Save the first Bid version before checking Managed Live readiness.'
          : unavailable
            ? 'The current Bid identity is not an immutable saved version. Reload it before checking Managed Live readiness.'
            : dirty
              ? 'The current draft has unsaved changes. Save or discard them before checking Managed Live readiness.'
              : stale
                ? 'A newer saved Bid or source revision exists. Load it before checking Managed Live readiness.'
                : `Current immutable saved version: ${version.versionNumber}.`}
      </p>
      <p className="text-sm text-muted-foreground">
        This is a read-only Managed Live preflight. No Live run is created by this check.
      </p>
      <Button
        type="button"
        variant="primary"
        disabled={busy || locked || stale || dirty || unavailable}
        onClick={() => void review()}
      >
        {busy ? 'Checking…' : 'Check Managed Live readiness'}
      </Button>
      {error && <p role="alert">{error}</p>}
      {reviewed &&
        ('policyError' in reviewed ? (
          <PolicyBlock result={reviewed} />
        ) : (
          <ReadinessReview result={reviewed} />
        ))}
    </FieldSection>
  );
}
