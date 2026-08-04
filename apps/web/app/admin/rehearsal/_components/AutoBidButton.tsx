'use client';

import { type ReactElement, useState } from 'react';

interface Props {
  sessionId: string;
  strategy: 'first_eligible';
  count: number;
}

interface AutoBidResponse {
  picksMade: number;
  stoppedReason: string;
  detail?: string;
  bootstrapped?: boolean;
}

export function AutoBidButton({ sessionId, strategy, count }: Props): ReactElement {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<'ok' | 'warn' | 'err' | null>(null);

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
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          setTone(null);
          try {
            const res = await fetch(`/api/admin/rehearsal/${sessionId}/auto-bid`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ count, strategy }),
            });
            if (!res.ok && res.status !== 207) {
              throw new Error(`${res.status} ${await res.text()}`);
            }
            const body = (await res.json()) as AutoBidResponse;
            const summary = formatStopped(body);
            setMsg(summary.text);
            setTone(summary.tone);
          } catch (e) {
            setMsg(`Failed: ${(e as Error).message}`);
            setTone('err');
          } finally {
            setBusy(false);
          }
        }}
        className="rounded bg-blue-700 px-3 py-1 text-white text-xs disabled:opacity-50"
      >
        {busy ? 'Running…' : label}
      </button>
      {msg !== null ? (
        <output
          data-testid={`auto-bid-status-${strategy}`}
          data-tone={tone}
          className={
            tone === 'err'
              ? 'text-xs text-red-700'
              : tone === 'warn'
                ? 'text-xs text-amber-700'
                : 'text-xs text-emerald-700'
          }
        >
          {msg}
        </output>
      ) : null}
    </span>
  );
}
