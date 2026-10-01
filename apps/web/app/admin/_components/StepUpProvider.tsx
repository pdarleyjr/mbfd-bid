'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  BEFORE_OPERATOR_COMMAND,
  OPERATOR_AUTH_REFRESHED,
  OPERATOR_STEP_UP_REQUIRED,
  type OperatorStepUpStatus,
  beforeOperatorCommand,
  observeOperatorResponse,
  operatorSignInRemaining,
  parseOperatorStepUpStatus,
} from '@/lib/operator-step-up';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';

interface StepUpProviderProps {
  children: ReactNode;
  initialStatus?: OperatorStepUpStatus | undefined;
}
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export function stepUpAuthenticationPath(pathname: string, search: string): string {
  return `/api/auth/start?returnTo=${encodeURIComponent(`${pathname}${search}`)}`;
}
function protectedApi(input: FetchInput): boolean {
  try {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    );
    return (
      url.origin === window.location.origin &&
      (url.pathname === '/api/admin' ||
        url.pathname.startsWith('/api/admin/') ||
        url.pathname === '/api/bid' ||
        url.pathname.startsWith('/api/bid/'))
    );
  } catch {
    return false;
  }
}

export function StepUpProvider({ children, initialStatus }: StepUpProviderProps) {
  const client = useQueryClient();
  const initialOperator = useRef(initialStatus?.operatorKey ?? null);
  const clock = useRef({ status: initialStatus ?? null, receivedAt: Date.now() });
  const blocked = useRef(false);
  const required = useRef(false);
  const checking = useRef(false);
  const [remaining, setRemaining] = useState(
    initialStatus ? operatorSignInRemaining(initialStatus) : null,
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [identityChanged, setIdentityChanged] = useState(false);

  useEffect(() => {
    function remainingNow() {
      return clock.current.status === null
        ? null
        : operatorSignInRemaining(
            clock.current.status,
            Math.floor((Date.now() - clock.current.receivedAt) / 1000),
          );
    }
    function beforeCommand(event: Event) {
      if (blocked.current || required.current || remainingNow() === 0) {
        event.preventDefault();
        (event as CustomEvent<{ error: string }>).detail.error = blocked.current
          ? 'operator_changed'
          : 'step_up_required';
        if (!blocked.current) setOpen(true);
      }
    }
    const needStepUp = () => {
      required.current = true;
      setRemaining(0);
      setOpen(true);
    };
    window.addEventListener(BEFORE_OPERATOR_COMMAND, beforeCommand);
    window.addEventListener(OPERATOR_STEP_UP_REQUIRED, needStepUp);
    const timer = setInterval(() => setRemaining(required.current ? 0 : remainingNow()), 1000);
    const originalFetch = window.fetch;
    const wrapped: typeof fetch = async (input: FetchInput, init?: FetchInit) => {
      if (!protectedApi(input)) return originalFetch(input, init);
      const method = (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        const error = beforeOperatorCommand();
        if (error !== null) return Response.json({ error }, { status: 401 });
      }
      return observeOperatorResponse(await originalFetch(input, init));
    };
    window.fetch = wrapped;
    return () => {
      clearInterval(timer);
      window.removeEventListener(BEFORE_OPERATOR_COMMAND, beforeCommand);
      window.removeEventListener(OPERATOR_STEP_UP_REQUIRED, needStepUp);
      if (window.fetch === wrapped) window.fetch = originalFetch;
    };
  }, []);

  async function recheck() {
    if (checking.current || blocked.current) return;
    checking.current = true;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/operator-status', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const status = parseOperatorStepUpStatus(await response.json().catch(() => null));
      if (!response.ok || status === null)
        throw new Error(
          'Sign-in could not be verified. Sign in again, then recheck. Your unfinished work is retained.',
        );
      if (initialOperator.current === null || status.operatorKey !== initialOperator.current) {
        blocked.current = true;
        setIdentityChanged(true);
        throw new Error(
          'Operator identity changed. Reopen this console before recording a command. Your unfinished work remains visible.',
        );
      }
      if (operatorSignInRemaining(status) === 0)
        throw new Error(
          'The sign-in is still expired. Complete a fresh Hub sign-in, then recheck.',
        );
      clock.current = { status, receivedAt: Date.now() };
      required.current = false;
      setRemaining(operatorSignInRemaining(status));
      setOpen(false);
      setMessage(
        'Operator sign-in refreshed. Review the latest state, then retry the command deliberately.',
      );
      await client.invalidateQueries();
      window.dispatchEvent(new Event(OPERATOR_AUTH_REFRESHED));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sign-in could not be verified.');
    } finally {
      checking.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      {(remaining !== null || message) && (
        <aside
          aria-label="Operator sign-in status"
          className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded border border-border bg-card p-3 text-sm"
        >
          <span>
            {identityChanged
              ? 'Operator identity changed'
              : remaining === 0
                ? 'Operator sign-in expired'
                : remaining === null
                  ? 'Operator sign-in'
                  : `Operator sign-in: ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} remaining`}
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={identityChanged}
            onClick={() => setOpen(true)}
          >
            Refresh operator sign-in
          </Button>
          {message && (
            <p role="status" className="w-full">
              {message}
            </p>
          )}
        </aside>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogTitle className="font-heading text-xl">Refresh operator sign-in</DialogTitle>
          <DialogDescription className="mt-2 text-sm">
            Your console and unfinished reason remain here. Sign in through Hub in a separate tab,
            return here, and recheck. No command will be submitted automatically.
          </DialogDescription>
          <a
            className="mt-4 inline-flex min-h-11 items-center text-info underline"
            href={stepUpAuthenticationPath('/admin/step-up', '')}
            target="_blank"
            rel="noopener noreferrer"
          >
            Sign in through Hub
          </a>
          {message && (
            <p role="status" className="mt-3 text-sm">
              {message}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" disabled={busy || identityChanged} onClick={() => void recheck()}>
              {busy ? 'Checking…' : 'Recheck sign-in'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Keep working
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {children}
    </>
  );
}
