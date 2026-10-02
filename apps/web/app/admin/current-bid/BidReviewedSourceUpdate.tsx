'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OPERATOR_AUTH_REFRESHED, OPERATOR_REAUTH_STARTED } from '@/lib/operator-step-up';
import { useEffect, useRef, useState } from 'react';
import { BidRequestError, bidRequest } from './bid-client';
import {
  type ReviewedUpdatePending,
  ReviewedUpdatePendingSchema,
  type ReviewedUpdatePreview,
  ReviewedUpdatePreviewSchema,
  ReviewedUpdateReadbackSchema,
  type ReviewedUpdateReceipt,
  ReviewedUpdateResultSchema,
  reviewedReceiptMatchesRequest,
  reviewedUpdateMessage,
} from './reviewed-source-update-client';

const message = (caught: unknown) =>
  caught instanceof BidRequestError
    ? reviewedUpdateMessage(caught.code)
    : caught instanceof Error
      ? caught.message
      : 'The source review could not be completed.';
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function BidReviewedSourceUpdate({
  actorScope,
  version,
  disabled,
  onApply,
}: {
  actorScope: string;
  version: { id: string; revision: number; sha256: string };
  disabled: boolean;
  onApply(update: ReviewedUpdateReceipt): void;
}) {
  const storageKey = `mbfd-reviewed-source-update:${actorScope}:2026`;
  const [preview, setPreview] = useState<ReviewedUpdatePreview | null>(null);
  const [pending, setPending] = useState<ReviewedUpdatePending | null>(null);
  const [verified, setVerified] = useState<ReviewedUpdateReceipt | null>(null);
  const [reason, setReason] = useState(
    'Capture the reviewed October 1 workbook and credential update for a new Bid version.',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const working = useRef(false);
  const owner = useRef(actorScope);
  owner.current = actorScope;
  const current = useRef({ version, disabled, onApply });
  current.current = { version, disabled, onApply };
  const stamp = JSON.stringify(version);
  const reviewedVersion = useRef(stamp);

  const preserve = (value: ReviewedUpdatePending) => {
    window.sessionStorage.setItem(storageKey, JSON.stringify(value));
    if (owner.current === value.actorScope) setPending(value);
  };
  const archive = (value: ReviewedUpdatePending, status: 'NOT_RECORDED' | 'VERIFIED_RECORDED') => {
    window.sessionStorage.setItem(
      `${storageKey}:history:${value.key}`,
      JSON.stringify({ status, archivedAt: new Date().toISOString(), retained: value }),
    );
    window.sessionStorage.removeItem(storageKey);
    setPending(null);
    setVerified(null);
    setPreview(null);
  };
  useEffect(() => {
    generation.current++;
    setPending(null);
    setVerified(null);
    setPreview(null);
    setStorageError(false);
    try {
      const text = window.sessionStorage.getItem(storageKey);
      if (!text) return;
      const saved = ReviewedUpdatePendingSchema.parse(JSON.parse(text));
      if (saved.actorScope !== actorScope)
        throw new Error('Source request belongs to another operator.');
      setPending(saved);
      setReason(saved.request.reason);
      setNotice(
        saved.receipt
          ? 'The update was recorded. Verify its receipt before loading it into the Bid draft.'
          : 'An unfinished capture was recovered. Retry the exact request to check its outcome.',
      );
    } catch {
      setStorageError(true);
      setError(
        'The retained source request could not be read. Keep this tab open and recover it before capturing another update.',
      );
    }
  }, [actorScope, storageKey]);
  useEffect(() => {
    if (reviewedVersion.current === stamp) return;
    reviewedVersion.current = stamp;
    generation.current++;
    setPreview(null);
    setVerified(null);
  }, [stamp]);
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
      setPreview(null);
      setVerified(null);
    };
    window.addEventListener(OPERATOR_REAUTH_STARTED, invalidate);
    window.addEventListener(OPERATOR_AUTH_REFRESHED, invalidate);
    return () => {
      generation.current++;
      window.removeEventListener(OPERATOR_REAUTH_STARTED, invalidate);
      window.removeEventListener(OPERATOR_AUTH_REFRESHED, invalidate);
    };
  }, []);

  const matchesVersion = (expected: {
    versionId: string;
    revision?: number;
    sha256?: string;
    sourceVersionSha256?: string;
  }) =>
    expected.versionId === current.current.version.id &&
    (expected.revision === undefined || expected.revision === current.current.version.revision) &&
    (expected.sha256 ?? expected.sourceVersionSha256) === current.current.version.sha256;
  const begin = () => {
    if (working.current || current.current.disabled || storageError) return false;
    working.current = true;
    setBusy(true);
    setError(null);
    return true;
  };
  const finish = () => {
    working.current = false;
    setBusy(false);
  };
  async function review() {
    if (pending || !begin()) return;
    const operation = ++generation.current;
    try {
      const result = await bidRequest(
        2026,
        'evidence-updates/preview',
        ReviewedUpdatePreviewSchema,
      );
      if (operation !== generation.current) return;
      if (!matchesVersion(result.expected))
        throw new Error('The saved Bid changed. Refresh the Bid before reviewing its source.');
      setPreview(result);
      setNotice(null);
    } catch (caught) {
      if (operation === generation.current) setError(message(caught));
    } finally {
      finish();
    }
  }
  async function readback(request: ReviewedUpdatePending, operation = generation.current) {
    if (!request.receipt) return;
    const result = await bidRequest(
      2026,
      `evidence-updates/${encodeURIComponent(request.receipt.freezeId)}`,
      ReviewedUpdateReadbackSchema,
    );
    if (
      !same(result.update, request.receipt) ||
      !reviewedReceiptMatchesRequest(result.update, request.request)
    )
      throw new Error(
        'The captured receipt did not match its recorded readback. Review it before loading a draft.',
      );
    if (operation !== generation.current || owner.current !== request.actorScope) return;
    setVerified(result.update);
    if (
      !matchesVersion({
        versionId: result.update.sourceVersionId,
        sourceVersionSha256: result.update.sourceVersionSha256,
      })
    )
      throw new Error(
        'The saved Bid changed after this capture. Its receipt remains recorded; refresh and review the current Bid.',
      );
    setNotice(
      'Source update recorded and verified. Load it into the draft, review the changes, then Save Bid.',
    );
  }
  async function capture() {
    if (!begin()) return;
    const operation = generation.current;
    let request = pending;
    try {
      if (!request) {
        if (!preview?.ready || !matchesVersion(preview.expected) || reason.trim().length < 4)
          return;
        request = {
          v: 1,
          actorScope,
          year: 2026,
          key: crypto.randomUUID(),
          request: { expected: preview.expected, reason: reason.trim() },
        };
        preserve(request);
      }
      if (!request.receipt) {
        const result = await bidRequest(2026, 'evidence-updates', ReviewedUpdateResultSchema, {
          body: request.request,
          key: request.key,
        });
        if (!reviewedReceiptMatchesRequest(result.update, request.request))
          throw new Error(
            'The capture response does not match the retained request. Recover the exact receipt before continuing.',
          );
        request = { ...request, receipt: result.update };
        preserve(request);
        if (owner.current !== request.actorScope) return;
        setNotice('The update was recorded. Verifying its receipt…');
      }
      await readback(request, operation);
    } catch (caught) {
      if (owner.current !== actorScope || operation !== generation.current) return;
      if (
        request &&
        !request.receipt &&
        caught instanceof BidRequestError &&
        caught.code === 'evidence_update_source_changed' &&
        caught.recorded === false
      ) {
        try {
          archive(request, 'NOT_RECORDED');
          setNotice(
            'The source changed and the server confirmed this request was not recorded. The rejected request was retained for recovery. Review the latest source before capturing again.',
          );
          setError(null);
        } catch {
          setStorageError(true);
          setError('The rejected request could not be retained. Keep this tab open to recover it.');
        }
      } else setError(message(caught));
    } finally {
      finish();
    }
  }
  function apply() {
    if (
      !verified ||
      !pending?.receipt ||
      busy ||
      disabled ||
      storageError ||
      !same(verified, pending.receipt) ||
      !reviewedReceiptMatchesRequest(verified, pending.request) ||
      !matchesVersion({
        versionId: verified.sourceVersionId,
        sourceVersionSha256: verified.sourceVersionSha256,
      })
    )
      return;
    try {
      current.current.onApply(verified);
      window.sessionStorage.removeItem(storageKey);
      setPending(null);
      setVerified(null);
      setPreview(null);
      setNotice(
        'The reviewed source is in your draft. Review changes and Save Bid to create a new version.',
      );
    } catch (caught) {
      setError(message(caught));
    }
  }
  const verifiedMatchesVersion =
    verified &&
    matchesVersion({
      versionId: verified.sourceVersionId,
      sourceVersionSha256: verified.sourceVersionSha256,
    });
  function retainRecordedUpdate() {
    if (
      !verified ||
      !pending?.receipt ||
      verifiedMatchesVersion ||
      busy ||
      disabled ||
      storageError ||
      !same(verified, pending.receipt) ||
      !reviewedReceiptMatchesRequest(verified, pending.request)
    )
      return;
    try {
      archive(pending, 'VERIFIED_RECORDED');
      setError(null);
      setNotice(
        'The recorded update remains in the audit history and its verified receipt was retained here. Review the current saved Bid before capturing a new update.',
      );
    } catch {
      setStorageError(true);
      setError('The verified receipt could not be retained. Keep this tab open to recover it.');
    }
  }
  return (
    <details className="rounded-lg border border-border bg-card p-4">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">
        Update reviewed source files
      </summary>
      <section aria-label="Reviewed source update" className="mt-3 space-y-3">
        <p className="text-sm text-muted-foreground">
          Review the latest approved Department evidence for a new Bid version. Existing bid
          sessions keep their captured source. Finish the credential import review first.
        </p>
        {disabled && (
          <p className="text-sm">
            Save or discard unfinished Bid edits and recover pending requests before reviewing a new
            source.
          </p>
        )}
        {error && (
          <p role="alert" className="whitespace-pre-line text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && <output className="block text-sm">{notice}</output>}
        {!pending && (
          <Button
            type="button"
            disabled={busy || disabled || storageError}
            onClick={() => void review()}
          >
            Review latest source
          </Button>
        )}
        {preview && (
          <div className="space-y-2 text-sm">
            <p>
              {preview.counts.members} Department members ·{' '}
              {preview.counts.approvedQualificationEvents} approved qualification events ·{' '}
              {preview.counts.pendingQualificationHolds} credential exceptions retained
            </p>
            <p>
              Eligibility dates: credentials {preview.eligibilityDates.credentialEvaluationOn} and
              personnel {preview.eligibilityDates.personnelEvaluationOn}.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {preview.sourceImports.map((source) => (
                <li key={`${source.source}:${source.importId}`}>
                  {source.source} · {source.revision}
                </li>
              ))}
            </ul>
            {preview.blockers.length > 0 && (
              <ul role="alert" className="list-disc space-y-1 pl-5">
                {preview.blockers.map((code) => (
                  <li key={code}>{reviewedUpdateMessage(code)}</li>
                ))}
              </ul>
            )}
            <Label htmlFor="reviewed-source-reason">Review note</Label>
            <Input
              id="reviewed-source-reason"
              value={reason}
              disabled={busy || !!pending}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        )}
        {(preview || pending) && !verified && (
          <Button
            type="button"
            disabled={
              busy ||
              disabled ||
              storageError ||
              (!pending && (!preview?.ready || reason.trim().length < 4))
            }
            onClick={() => void capture()}
          >
            {busy
              ? 'Working…'
              : pending?.receipt
                ? 'Verify recorded update'
                : pending
                  ? 'Retry retained capture'
                  : 'Capture reviewed update'}
          </Button>
        )}
        {verified && verifiedMatchesVersion && (
          <Button type="button" disabled={busy || disabled || storageError} onClick={apply}>
            Load reviewed update into draft
          </Button>
        )}
        {verified && !verifiedMatchesVersion && (
          <Button
            type="button"
            disabled={busy || disabled || storageError}
            onClick={retainRecordedUpdate}
          >
            Keep recorded update and return to source review
          </Button>
        )}
      </section>
    </details>
  );
}
