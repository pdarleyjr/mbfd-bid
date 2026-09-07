'use client';

import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { type ReactElement, useEffect, useRef, useState } from 'react';

interface Props {
  sessionId: string;
  strategy: 'first_eligible';
  count: number;
  /** D1 mock-control revision, intentionally independent of DO lastSeq. */
  mockControlRevision: number | null;
}

interface AutoBidResponse {
  picksMade: number;
  stoppedReason: string;
  detail?: string;
  bootstrapped?: boolean;
  mock_control_revision?: number;
  error?: string;
  current_mock_control_revision?: number;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // The key is not an authentication secret. This browser fallback preserves
  // request identity when a legacy test browser lacks Web Crypto UUID support.
  return `rehearsal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorText(status: number, body: AutoBidResponse, raw: string): string {
  if (body.error === 'stale_mock_control_revision') {
    return 'The mock board changed. It has been refreshed; review it before trying again.';
  }
  if (body.error === 'rehearsal_command_outcome_unknown') {
    return 'The command outcome is unknown. Do not submit it again; refresh and contact an administrator.';
  }
  if (status === 401 || status === 403) {
    return 'Fresh administrator authentication is required before a mock command can run.';
  }
  return `Request rejected (${status}): ${body.detail ?? body.error ?? raw.slice(0, 180)}`;
}

export function AutoBidButton({
  sessionId,
  strategy,
  count,
  mockControlRevision,
}: Props): ReactElement {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<'ok' | 'warn' | 'err' | null>(null);
  const [knownRevision, setKnownRevision] = useState<number | null>(mockControlRevision);
  const pendingCommand = useRef<{ key: string; revision: number } | null>(null);
  const router = useRouter();

  useEffect(() => {
    setKnownRevision(mockControlRevision);
    if (pendingCommand.current?.revision !== mockControlRevision) {
      pendingCommand.current = null;
    }
  }, [mockControlRevision]);

  const label = `Auto-bid ${count} picks (first-eligible)`;

  function formatStopped(body: AutoBidResponse): { text: string; tone: 'ok' | 'warn' | 'err' } {
    const bootstrapNote = body.bootstrapped ? ' (auto-started the session)' : '';
    if (body.stoppedReason === 'count_reached') {
      return { text: `Made ${body.picksMade} picks — done${bootstrapNote}.`, tone: 'ok' };
    }
    if (body.stoppedReason === 'complete') {
      return {
        text: `Made ${body.picksMade} picks — bid is complete${bootstrapNote}.`,
        tone: 'ok',
      };
    }
    if (body.stoppedReason === 'no_eligible') {
      return {
        text: `Made ${body.picksMade} picks — stopped on 5 consecutive members with no eligible position. ${body.detail ?? ''}`.trim(),
        tone: 'warn',
      };
    }
    // error
    return {
      text: `Stopped: ${body.detail ?? 'unknown error'} (picksMade=${body.picksMade}).`,
      tone: 'err',
    };
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        disabled={busy || knownRevision === null}
        onClick={async () => {
          if (knownRevision === null) {
            setMsg('Mock control state is unavailable. Refresh before submitting a pick.');
            setTone('err');
            return;
          }
          setBusy(true);
          setMsg(null);
          setTone(null);
          const command =
            pendingCommand.current?.revision === knownRevision
              ? pendingCommand.current
              : { key: newIdempotencyKey(), revision: knownRevision };
          pendingCommand.current = command;
          try {
            const res = await fetch(`/api/admin/rehearsal/${sessionId}/auto-bid`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': command.key,
              },
              credentials: 'include',
              body: JSON.stringify({
                count,
                strategy,
                expected_mock_control_revision: command.revision,
              }),
            });
            if (!res.ok && res.status !== 207) {
              const raw = await res.text();
              let body: AutoBidResponse = {} as AutoBidResponse;
              try {
                body = JSON.parse(raw) as AutoBidResponse;
              } catch {
                // The status is still authoritative; preserve a transport-safe
                // key for ambiguous server failures below.
              }
              if (body.error === 'stale_mock_control_revision') {
                setKnownRevision(body.current_mock_control_revision ?? null);
                router.refresh();
              }
              // A network or server-failure result can arrive after the Worker
              // reserved the immutable receipt. Retain the key in that case so
              // a retry can only replay, never create a second command.
              if (res.status < 500 && body.error !== 'rehearsal_command_outcome_unknown') {
                pendingCommand.current = null;
              }
              setMsg(errorText(res.status, body, raw));
              setTone('err');
              return;
            }
            const body = (await res.json()) as AutoBidResponse;
            pendingCommand.current = null;
            if (typeof body.mock_control_revision === 'number') {
              setKnownRevision(body.mock_control_revision);
            }
            router.refresh();
            const summary = formatStopped(body);
            setMsg(summary.text);
            setTone(summary.tone);
          } catch (e) {
            // Preserve the idempotency key after a transport failure. The next
            // attempt is therefore an exact replay, not another mock command.
            setMsg(`Connection failed; the command was not retried: ${(e as Error).message}`);
            setTone('err');
          } finally {
            setBusy(false);
          }
        }}
        className="rounded bg-info px-3 py-1 text-primary-foreground text-xs disabled:opacity-50"
      >
        {busy ? 'Running…' : label}
      </Button>
      {msg !== null ? (
        <output
          data-testid={`auto-bid-status-${strategy}`}
          data-tone={tone}
          className={
            tone === 'err'
              ? 'text-xs text-destructive'
              : tone === 'warn'
                ? 'text-xs text-warning'
                : 'text-xs text-success'
          }
        >
          {msg}
        </output>
      ) : null}
    </span>
  );
}
