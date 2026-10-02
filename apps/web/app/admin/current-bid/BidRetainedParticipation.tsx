'use client';

import { Button } from '@/components/ui/button';
import {
  OPERATOR_AUTH_REFRESHED,
  OPERATOR_REAUTH_STARTED,
  OPERATOR_STEP_UP_REQUIRED,
} from '@/lib/operator-step-up';
import {
  type RetainedParticipationPreviewResponse,
  RetainedParticipationPreviewResponseSchema,
} from '@mbfd/shared';
import { useEffect, useRef, useState } from 'react';
import { BidRequestError, type CurrentBid, CurrentBidSchema, bidRequest } from './bid-client';

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const rankNames = { CPT: 'Captains', LT: 'Lieutenants', FF: 'Firefighters' } as const;
const explanations: Record<string, string> = {
  bid_definition_or_source_changed:
    'The saved Bid changed. Refresh the saved Bid and review the retained participation again.',
  retained_participation_source_changed:
    'The saved Bid changed. Refresh the saved Bid and review the retained participation again.',
  retained_participation_original_pin_required:
    'This review requires the saved original evidence before retained participation or a later source update has been applied.',
  retained_participation_preview_failed:
    'The retained participation could not be verified from the saved original evidence. Review the source decisions and save any changes before trying again.',
  retained_participation_source_decision_required:
    'Resolve the Lieutenant source decision in the existing source review, then Save Bid before reviewing retained participation.',
  invalid_server_response:
    'The server response could not be verified. Review again before loading a draft.',
};
const message = (caught: unknown) =>
  caught instanceof BidRequestError
    ? (explanations[caught.code] ?? caught.message)
    : caught instanceof Error
      ? caught.message
      : 'The retained participation could not be reviewed.';

/** A read-only server proposal becomes a draft only after explicit review.
 * Existing Save owns validation, audit, idempotency and version creation. */
export function BidRetainedParticipation({
  actorScope,
  base,
  draftStamp,
  disabled,
  onApply,
  onReviewSources,
}: {
  actorScope: string;
  base: CurrentBid;
  draftStamp: string;
  disabled: boolean;
  onApply(proposal: RetainedParticipationPreviewResponse): void;
  onReviewSources?(): void;
}) {
  const [proposal, setProposal] = useState<RetainedParticipationPreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const working = useRef(false);
  const current = useRef({ actorScope, base, draftStamp, disabled, onApply });
  current.current = { actorScope, base, draftStamp, disabled, onApply };
  const sourceDecisions = base.content.sourceDecisions.filter(
    (decision) => decision.issueId === '2026-latest-lieutenant-capacity',
  );
  const sourceReady = sourceDecisions.length === 1 && sourceDecisions[0]?.status === 'RESOLVED';
  const contextStamp = JSON.stringify([actorScope, base.expected, draftStamp, disabled]);
  const previousContext = useRef(contextStamp);
  if (previousContext.current !== contextStamp) {
    previousContext.current = contextStamp;
    generation.current++;
  }
  useEffect(() => {
    if (previousContext.current !== contextStamp) return;
    setProposal(null);
    setError(null);
  }, [contextStamp]);
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
      setProposal(null);
      setError(null);
    };
    window.addEventListener(OPERATOR_REAUTH_STARTED, invalidate);
    window.addEventListener(OPERATOR_AUTH_REFRESHED, invalidate);
    window.addEventListener(OPERATOR_STEP_UP_REQUIRED, invalidate);
    return () => {
      generation.current++;
      window.removeEventListener(OPERATOR_REAUTH_STARTED, invalidate);
      window.removeEventListener(OPERATOR_AUTH_REFRESHED, invalidate);
      window.removeEventListener(OPERATOR_STEP_UP_REQUIRED, invalidate);
    };
  }, []);

  const begin = () => {
    if (
      working.current ||
      current.current.disabled ||
      current.current.base.expected.kind !== 'version' ||
      !sourceReady
    )
      return false;
    working.current = true;
    setBusy(true);
    setError(null);
    return true;
  };
  const validContext = (operation: number, capturedContext: string) =>
    operation === generation.current &&
    capturedContext === previousContext.current &&
    !current.current.disabled;
  const matchesSource = (value: RetainedParticipationPreviewResponse) => {
    const saved = current.current.base;
    const pin = saved.content.settings?.v === 3 ? saved.content.settings.evidenceFreeze : null;
    return (
      same(value.expected, saved.expected) &&
      pin !== null &&
      pin !== undefined &&
      value.source.freezeId === pin.freezeId &&
      value.source.evaluationSha256 === pin.evaluationSha256 &&
      value.source.personnelSha256 === pin.personnelSnapshot.sha256 &&
      value.source.credentialSha256 === pin.credentialSnapshot.sha256 &&
      value.source.sourceVersionId === pin.sourceVersionId &&
      value.source.sourceVersionSha256 === pin.sourceVersionSha256
    );
  };
  async function review() {
    if (!begin()) return;
    const operation = ++generation.current;
    const capturedContext = previousContext.current;
    const expected = current.current.base.expected;
    setProposal(null);
    try {
      const result = await bidRequest(
        2026,
        'retained-participation/preview',
        RetainedParticipationPreviewResponseSchema,
        {
          body: { expected },
        },
      );
      if (!validContext(operation, capturedContext)) return;
      if (!matchesSource(result))
        throw new Error(
          'The proposal does not match this saved Bid and its original evidence. Refresh and review again.',
        );
      setProposal(result);
    } catch (caught) {
      if (validContext(operation, capturedContext)) setError(message(caught));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function apply() {
    if (!proposal || !begin()) return;
    const operation = ++generation.current;
    const capturedContext = previousContext.current;
    try {
      const fresh = await bidRequest(2026, 'current', CurrentBidSchema);
      if (!validContext(operation, capturedContext)) return;
      if (
        !same(fresh.expected, proposal.expected) ||
        !same(fresh.content, current.current.base.content) ||
        !matchesSource(proposal)
      )
        throw new Error(
          'The saved Bid changed after this review. Refresh the saved Bid and review again.',
        );
      current.current.onApply(proposal);
      setProposal(null);
    } catch (caught) {
      if (validContext(operation, capturedContext)) {
        setProposal(null);
        setError(message(caught));
      }
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <details className="min-w-0 rounded-lg border border-border bg-card p-4">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">
        Reconcile retained participation
      </summary>
      <div className="min-w-0 space-y-3 pt-2">
        <p className="text-sm text-muted-foreground">
          Review members who retain their assigned positions using the original frozen evidence.
          Resolve and save the Lieutenant source decision first.
        </p>
        {disabled && (
          <p className="text-sm">
            Save or discard your draft changes and refresh any stale Bid before reviewing.
          </p>
        )}
        {!sourceReady && (
          <div className="space-y-2 text-sm">
            <p>
              Resolve the Lieutenant capacity decision in Source decisions, then Save Bid before
              reviewing retained participation.
            </p>
            {onReviewSources && (
              <Button type="button" disabled={disabled || busy} onClick={onReviewSources}>
                Review source decisions
              </Button>
            )}
          </div>
        )}
        <Button
          type="button"
          disabled={disabled || busy || !sourceReady}
          onClick={() => void review()}
        >
          {busy ? 'Checking…' : 'Review retained participation'}
        </Button>
        {error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
        )}
        {proposal && !disabled && (
          <section aria-label="Retained participation proposal" className="min-w-0 space-y-3">
            <p className="font-semibold">
              Ordinary participants: {proposal.beforeCounts.ordinaryParticipants} →{' '}
              {proposal.counts.ordinaryParticipants}
            </p>
            <p className="text-sm">
              {proposal.retainedCount} members retain their positions. Stage entries:{' '}
              {proposal.beforeCounts.stageEntries} → {proposal.counts.stageEntries}.
            </p>
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {(['CPT', 'LT', 'FF'] as const).map((rank) => (
                <li key={rank}>
                  {rankNames[rank]}: {proposal.beforeCounts.ranks[rank]} →{' '}
                  {proposal.counts.ranks[rank]}
                </li>
              ))}
            </ul>
            <ul className="space-y-2 text-sm">
              {proposal.retained.map((member) => (
                <li
                  key={member.memberId}
                  className="flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-1 rounded border border-border p-3"
                >
                  <span className="min-w-0 break-words">
                    {member.displayName} · {member.rank}
                  </span>
                  <span className="font-semibold">
                    {member.positionId} · retained, closed to bidding
                  </span>
                </li>
              ))}
            </ul>
            <details className="text-xs text-muted-foreground">
              <summary className="min-h-11 cursor-pointer content-center">
                Original source proof
              </summary>
              <dl className="space-y-2 break-all">
                <div>
                  <dt>Frozen evidence</dt>
                  <dd>{proposal.source.freezeId}</dd>
                </div>
                <div>
                  <dt>Evaluation SHA-256</dt>
                  <dd>{proposal.source.evaluationSha256}</dd>
                </div>
                <div>
                  <dt>Personnel SHA-256</dt>
                  <dd>{proposal.source.personnelSha256}</dd>
                </div>
                <div>
                  <dt>Credential SHA-256</dt>
                  <dd>{proposal.source.credentialSha256}</dd>
                </div>
                <div>
                  <dt>Proposal SHA-256</dt>
                  <dd>{proposal.proposalSha256}</dd>
                </div>
              </dl>
            </details>
            <p className="text-sm">
              Load this proposal into your draft, review the changes, then Save Bid. Existing
              sessions keep their saved versions.
            </p>
            <Button type="button" variant="primary" disabled={busy} onClick={() => void apply()}>
              Load reviewed participation into draft
            </Button>
          </section>
        )}
      </div>
    </details>
  );
}
