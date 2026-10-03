'use client';

import { Button } from '@/components/ui/button';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { FieldSection } from './BidFields';
import { BidTermIssues } from './BidTermIssues';
import {
  type BidLivePreview,
  BidLivePreviewSchema,
  type BidLiveResult,
  BidRequestError,
  type BidVersion,
  type CurrentBid,
  bidRequest,
} from './bid-client';
import type { PendingBidWrite } from './bid-draft';

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
      : 'The Real Bid readiness check could not be completed.';
}

function PolicyBlock({
  result,
  onOpenAssignmentTerms,
}: {
  result: Extract<BidLivePreview, { policyError: string }>;
  onOpenAssignmentTerms(): void;
}) {
  const assignmentTermBlock = result.policyError === 'assignment_term_evidence_requires_review';
  return (
    <div role="alert" className="space-y-2 rounded border border-warning p-4 text-sm">
      {assignmentTermBlock ? (
        <>
          <p className="font-semibold">Assignment terms need review.</p>
          <p>
            Record the listed Days terms, save the Bid, then check again. Mock training remains
            available.
          </p>
          <Link
            href="/admin/source-review"
            className="inline-flex min-h-11 items-center font-semibold underline"
          >
            Review source decisions and evidence
          </Link>
          <Button type="button" variant="secondary" onClick={onOpenAssignmentTerms}>
            Edit assignment terms
          </Button>
        </>
      ) : (
        <p>Real Bid needs review: {words(result.policyError)}.</p>
      )}
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
      <BidTermIssues issues={result.termIssues} />
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
      <p className="font-semibold">
        {isBlocked ? 'Resolve these items before the Real Bid.' : 'Ready to prepare the Real Bid.'}
      </p>
      {isBlocked && (
        <ul aria-label="Real Bid blockers" className="list-disc space-y-1 pl-5">
          {checks
            .filter((check) => result.readiness.blockingCheckIds.includes(check.id))
            .map((check) => (
              <li key={check.id}>
                {words(check.id)}
                {check.detail ? `: ${check.detail}` : ''}
              </li>
            ))}
        </ul>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer content-center font-medium">
          All readiness checks ({checks.length})
        </summary>
        <ul aria-label="Live readiness checks" className="mt-2 list-disc space-y-1 pl-5">
          {checks.map((check) => (
            <li key={check.id}>
              {words(check.status)} · {words(check.id)}
              {check.detail ? `: ${check.detail}` : ''}
            </li>
          ))}
        </ul>
      </details>
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
  execute?(write: PendingBidWrite): Promise<void>;
  createdLive?: BidLiveResult | null;
  onOpenAuthority(): void;
  onOpenAssignmentTerms(): void;
};

/**
 * Preflight is read-only. Creation is a separate deliberate action using the
 * exact reviewed version/context and the workspace's recoverable request path.
 * Starting the run remains a separate console command.
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
  execute,
  createdLive,
  onOpenAuthority,
  onOpenAssignmentTerms,
}: BidLiveReviewProps) {
  const grants =
    base.content.settings?.v === 3 ? base.content.settings.livePolicy.actionPermissions : [];
  const hasOperatorGrants = grants.some((grant) => grant.actorMemberIds.length > 0);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    if (!hasOperatorGrants) return;
    let cancelled = false;
    void (async () => {
      const entries = new Map<number, string>();
      let offset = 0;
      let total = 1;
      while (offset < total) {
        const response = await fetch(`/api/admin/members?limit=500&offset=${offset}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) return;
        const body = (await response.json()) as {
          total: number;
          members: { id: number; firstName: string; lastName: string; employeeId: string }[];
        };
        if (
          !Array.isArray(body.members) ||
          !Number.isSafeInteger(body.total) ||
          (body.members.length === 0 && offset < body.total)
        )
          return;
        for (const member of body.members)
          entries.set(member.id, `${member.lastName}, ${member.firstName} · ${member.employeeId}`);
        offset += body.members.length;
        total = body.total;
      }
      if (!cancelled) setNames(entries);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasOperatorGrants]);
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
      title="Prepare Real Bid"
      description="Check the saved Bid, then confirm session creation."
    >
      <details className="text-sm" aria-label="Saved operator authority">
        <summary className="min-h-11 cursor-pointer content-center font-semibold">
          Operator permissions
        </summary>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="secondary" onClick={onOpenAuthority}>
            Edit permissions
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">Saved with this Bid version.</p>
        <ul className="space-y-1 text-sm">
          {grants.map((grant) => (
            <li key={grant.action}>
              <strong>{words(grant.action)}:</strong>{' '}
              {grant.actorMemberIds.length
                ? grant.actorMemberIds
                    .map((id) => names.get(id) ?? `Member ${id} — catalog review required`)
                    .join(', ')
                : 'No members granted'}
            </li>
          ))}
        </ul>
      </details>
      <p className="text-sm">
        {base.version === null
          ? 'Save the first Bid version before preparing the Real Bid.'
          : unavailable
            ? 'Reload the saved Bid before preparing the Real Bid.'
            : dirty
              ? 'Save or discard your changes before preparing the Real Bid.'
              : stale
                ? 'Load the newer saved Bid before preparing the Real Bid.'
                : `Saved version ${version.versionNumber}.`}
      </p>
      <p className="text-sm text-muted-foreground">Checking does not start or create a session.</p>
      <Button
        type="button"
        variant="primary"
        disabled={busy || locked || stale || dirty || unavailable}
        onClick={() => void review()}
      >
        {busy ? 'Checking…' : 'Check Real Bid'}
      </Button>
      {error && <p role="alert">{error}</p>}
      {reviewed &&
        ('policyError' in reviewed ? (
          <PolicyBlock result={reviewed} onOpenAssignmentTerms={onOpenAssignmentTerms} />
        ) : (
          <ReadinessReview result={reviewed} />
        ))}
      {execute &&
        reviewed &&
        !('policyError' in reviewed) &&
        reviewed.wouldAllowCreateLive &&
        !createdLive && (
          <div className="space-y-3 rounded border border-warning p-4">
            <p>
              Create the Real session from saved version {reviewed.versionNumber}. You will start it
              from the bid console.
            </p>
            <Button
              type="button"
              disabled={busy || locked || dirty || stale}
              onClick={() =>
                void execute({
                  path: 'live-sessions',
                  key: crypto.randomUUID(),
                  body: {
                    versionId: reviewed.versionId,
                    versionSha256: reviewed.versionSha256,
                    expectedContextSha256: reviewed.contextSha256,
                    expectedSourceToken: reviewed.runtimeSourceToken,
                  },
                })
              }
            >
              Confirm Real Bid creation
            </Button>
          </div>
        )}
      {createdLive && (
        <p>
          Real session created; ready to start.{' '}
          <Link
            href={`/admin/bid?session_id=${encodeURIComponent(createdLive.id)}` as Route}
            className="underline"
          >
            Open Real Bid
          </Link>
        </p>
      )}
    </FieldSection>
  );
}
