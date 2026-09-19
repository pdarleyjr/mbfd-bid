'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { BidMockTransitionPreview } from './BidMockTransitionPreview';

const Channel = z.enum(['EMAIL', 'TARGETSOLUTIONS']);
const Distribution = z.object({
  sessionId: z.string(),
  completion: z.object({
    revision: z.number().int(),
    commandId: z.string(),
    completedAtMs: z.number(),
  }),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['EXTERNAL_PUBLICATION_REQUIRED', 'EXTERNAL_EVIDENCE_RECORDED']),
  externalDeliveryPerformed: z.literal(false),
  channels: z.array(
    z.object({
      channel: Channel,
      review: z
        .object({
          revision: z.number().int(),
          status: z.enum(['COMPLETED', 'REQUIRES_FOLLOW_UP']),
          published_on: z.string().nullable(),
          evidence_ref: z.string(),
          actor_subject: z.string(),
        })
        .nullable(),
    }),
  ),
});
const label = (channel: z.infer<typeof Channel>) =>
  channel === 'EMAIL' ? 'Email distribution' : 'TargetSolutions bulletin';
async function bodyOf(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(
      error.success ? error.data.error.replaceAll('_', ' ') : 'Result distribution request failed',
    );
  }
  return body;
}

export function BidResultDistribution({
  sessionId,
  isMock,
  completionVerified,
}: { sessionId: string; isMock: boolean; completionVerified: boolean }) {
  const [distribution, setDistribution] = useState<z.infer<typeof Distribution> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState<z.infer<typeof Channel>>('EMAIL');
  const [status, setStatus] = useState<'COMPLETED' | 'REQUIRES_FOLLOW_UP'>('COMPLETED');
  const [publishedOn, setPublishedOn] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const mutationFetch = useMemo(
    () => createCsrfAwareFetch(fetch, () => window.location.origin),
    [],
  );
  const path = `/api/admin/result-distribution/${encodeURIComponent(sessionId)}`;
  async function load() {
    const value = Distribution.parse(
      await bodyOf(await fetch(path, { credentials: 'same-origin', cache: 'no-store' })),
    );
    if (value.sessionId !== sessionId)
      throw new Error('Result package does not match selected run');
    setDistribution(value);
  }
  async function generate() {
    setBusy(true);
    setError('');
    setDistribution(null);
    try {
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Package unavailable');
    } finally {
      setBusy(false);
    }
  }
  async function review(event: React.FormEvent) {
    event.preventDefault();
    if (!distribution || !confirmed) return;
    const body = {
      expectedCompletionSeq: distribution.completion.revision,
      packageSha256: distribution.packageSha256,
      channel,
      expectedRevision:
        distribution.channels.find((item) => item.channel === channel)?.review?.revision ?? 0,
      status,
      publishedOn: status === 'COMPLETED' ? publishedOn : null,
      evidenceRef,
      reason,
    };
    const fingerprint = JSON.stringify(body);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      await bodyOf(
        await mutationFetch(`${path}/reviews`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': retry.current.key },
          body: fingerprint,
        }),
      );
      await load();
      setConfirmed(false);
      retry.current = null;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Review response unavailable; retry retains its request identity',
      );
    } finally {
      setBusy(false);
    }
  }
  if (isMock)
    return (
      <div className="space-y-3">
        <p>
          Mock results are rehearsal evidence. External publication and official distribution review
          are unavailable for Mock runs.
        </p>
        <BidMockTransitionPreview sessionId={sessionId} />
      </div>
    );
  return (
    <section
      aria-label="Final result distribution"
      className="space-y-3 rounded border border-border p-3"
    >
      <h3 className="font-semibold">Final result package and distribution</h3>
      <p>
        External publication required. Download the completed results for authorized email
        distribution and TargetSolutions publication. This application does not send or publish
        them.
      </p>
      {!completionVerified ? (
        <p>Verified official completion is required before generating the final package.</p>
      ) : null}
      <Button type="button" disabled={busy || !completionVerified} onClick={() => void generate()}>
        Generate final result package
      </Button>
      {error ? <p role="alert">{error}</p> : null}
      {distribution ? (
        <>
          <p className="break-all text-xs">
            Package SHA-256: {distribution.packageSha256} · Completion revision{' '}
            {distribution.completion.revision}
          </p>
          <nav aria-label="Final result downloads" className="flex flex-wrap gap-4 underline">
            <a href={`${path}/package/json?sha256=${distribution.packageSha256}`}>
              Download final package (JSON)
            </a>
            <a href={`${path}/package/csv?sha256=${distribution.packageSha256}`}>
              Export final results (CSV)
            </a>
          </nav>
          <output>
            {distribution.status === 'EXTERNAL_EVIDENCE_RECORDED'
              ? 'Authorized external publication evidence recorded for both channels.'
              : 'External publication still requires completed evidence for each channel.'}
          </output>
          <ul className="list-inside list-disc">
            {distribution.channels.map((item) => (
              <li key={item.channel}>
                {label(item.channel)}:{' '}
                {item.review
                  ? `${item.review.status === 'COMPLETED' ? 'Completion evidence reviewed' : 'Follow-up required'} — ${item.review.evidence_ref} (reviewer ${item.review.actor_subject}${item.review.published_on ? `; publication date ${item.review.published_on}` : ''})`
                  : 'Evidence required'}
              </li>
            ))}
          </ul>
          <form onSubmit={(event) => void review(event)}>
            <fieldset disabled={busy} className="grid gap-3">
              <legend className="font-semibold">
                Record authorized external publication evidence
              </legend>
              <Label>
                Distribution channel
                <NativeSelect
                  value={channel}
                  onChange={(event) => setChannel(Channel.parse(event.target.value))}
                >
                  <option value="EMAIL">Email distribution</option>
                  <option value="TARGETSOLUTIONS">TargetSolutions bulletin</option>
                </NativeSelect>
              </Label>
              <Label>
                Evidence outcome
                <NativeSelect
                  value={status}
                  onChange={(event) => setStatus(event.target.value as typeof status)}
                >
                  <option value="COMPLETED">Completion evidence reviewed</option>
                  <option value="REQUIRES_FOLLOW_UP">Follow-up required</option>
                </NativeSelect>
              </Label>
              {status === 'COMPLETED' ? (
                <Label>
                  External publication date
                  <Input
                    type="date"
                    required
                    value={publishedOn}
                    onChange={(event) => setPublishedOn(event.target.value)}
                  />
                </Label>
              ) : null}
              <Label>
                Evidence reference
                <Input
                  required
                  minLength={4}
                  maxLength={1000}
                  value={evidenceRef}
                  onChange={(event) => setEvidenceRef(event.target.value)}
                  placeholder="Sent message record or bulletin reference"
                />
              </Label>
              <Label>
                Review reason
                <Input
                  required
                  minLength={4}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Label>
              <Label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I reviewed authorized evidence for this exact final result package.
              </Label>
              <Button type="submit" disabled={!confirmed || busy}>
                Record reviewed evidence
              </Button>
              <p className="text-sm">
                Requires fresh administrator authentication and the frozen Bid publication
                permission. Corrections preserve earlier evidence.
              </p>
            </fieldset>
          </form>
        </>
      ) : null}
    </section>
  );
}
