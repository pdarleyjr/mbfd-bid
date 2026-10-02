'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  BEFORE_OPERATOR_COMMAND,
  OPERATOR_REAUTH_STARTED,
  OPERATOR_STEP_UP_REQUIRED,
  type OperatorStepUpStatus,
  beforeOperatorCommand,
  notifyOperatorAuthRefreshed,
  observeOperatorResponse,
  operatorSignInRemaining,
  parseOperatorStepUpStatus,
} from '@/lib/operator-step-up';
import {
  OPERATOR_SESSION_ACTIVITY_WINDOW_SEC,
  OPERATOR_SESSION_RENEW_INTERVAL_SEC,
} from '@mbfd/shared';
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
  const required = useRef(initialStatus === undefined);
  const checking = useRef(false);
  const renewing = useRef(false);
  const lastRenewal = useRef(
    initialStatus &&
      operatorSignInRemaining(initialStatus) > 0 &&
      operatorSignInRemaining(initialStatus) < OPERATOR_SESSION_RENEW_INTERVAL_SEC
      ? 0
      : Date.now(),
  );
  const lastActivity = useRef(Date.now());
  const rejectionGeneration = useRef(0);
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
      if (blocked.current || required.current || checking.current || remainingNow() === 0) {
        event.preventDefault();
        (event as CustomEvent<{ error: string }>).detail.error = blocked.current
          ? 'operator_changed'
          : 'step_up_required';
        if (!blocked.current) setOpen(true);
      }
    }
    const needStepUp = () => {
      rejectionGeneration.current += 1;
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
    async function renewActiveSession() {
      const now = Date.now();
      if (
        document.visibilityState !== 'visible' ||
        now - lastActivity.current > OPERATOR_SESSION_ACTIVITY_WINDOW_SEC * 1000 ||
        now - lastRenewal.current < OPERATOR_SESSION_RENEW_INTERVAL_SEC * 1000 ||
        renewing.current ||
        checking.current ||
        blocked.current ||
        required.current
      )
        return;
      renewing.current = true;
      lastRenewal.current = now;
      const generation = rejectionGeneration.current;
      try {
        const response = await originalFetch('/api/auth/operator-status', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const status = parseOperatorStepUpStatus(await response.json().catch(() => null));
        if (!response.ok || status === null) {
          if (response.status === 401) needStepUp();
          return;
        }
        if (status.operatorKey !== initialOperator.current) {
          blocked.current = true;
          required.current = true;
          setIdentityChanged(true);
          setOpen(true);
          setMessage('Operator identity changed. Reopen this console before recording a command.');
          return;
        }
        // This refresh changes timing only. It never clears a prepared choice,
        // invalidates an approval, or retries a command.
        if (generation !== rejectionGeneration.current || required.current) return;
        clock.current = { status, receivedAt: Date.now() };
        setRemaining(operatorSignInRemaining(status));
      } catch {
        // Existing authorization remains bounded by its signed expiry.
        // Any command still requires successful server-side Hub validation.
      } finally {
        renewing.current = false;
      }
    }
    const active = () => {
      lastActivity.current = Date.now();
      void renewActiveSession();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') active();
    };
    window.addEventListener('pointerdown', active);
    window.addEventListener('keydown', active);
    window.addEventListener('scroll', active);
    window.addEventListener('focus', active);
    document.addEventListener('visibilitychange', visible);
    const renewalTimer = setInterval(() => void renewActiveSession(), 60 * 1000);
    void renewActiveSession();
    return () => {
      clearInterval(timer);
      clearInterval(renewalTimer);
      window.removeEventListener(BEFORE_OPERATOR_COMMAND, beforeCommand);
      window.removeEventListener(OPERATOR_STEP_UP_REQUIRED, needStepUp);
      window.removeEventListener('pointerdown', active);
      window.removeEventListener('keydown', active);
      window.removeEventListener('scroll', active);
      window.removeEventListener('focus', active);
      document.removeEventListener('visibilitychange', visible);
      if (window.fetch === wrapped) window.fetch = originalFetch;
    };
  }, []);

  function startReauthentication() {
    required.current = true;
    setRemaining(0);
    window.dispatchEvent(new Event(OPERATOR_REAUTH_STARTED));
  }

  async function recheck() {
    if (checking.current || blocked.current) return;
    checking.current = true;
    startReauthentication();
    const recheckGeneration = rejectionGeneration.current;
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
      await client.invalidateQueries();
      if (rejectionGeneration.current !== recheckGeneration)
        throw new Error(
          'The session could not be verified while refreshing the console. Recheck sign-in before recording a command. Your unfinished work is retained.',
        );
      setRemaining(operatorSignInRemaining(status));
      setOpen(false);
      setMessage(
        'Operator sign-in refreshed. Review the latest state, then retry the command deliberately.',
      );
      notifyOperatorAuthRefreshed();
      required.current = false;
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
                  : remaining >= 24 * 60 * 60
                    ? `Signed in · ${Math.ceil(remaining / (24 * 60 * 60))} days remaining; renews while you use Bid`
                    : `Signed in · ${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m remaining; renews while you use Bid`}
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={identityChanged}
            onClick={() => setOpen(true)}
          >
            Refresh operator sign-in
          </Button>
          {message && <output className="w-full">{message}</output>}
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
            Your console and unfinished reason remain here. Recheck sign-in first. If the session
            cannot be verified, sign in through Hub in a separate tab, return here, and recheck. No
            command will be submitted automatically.
          </DialogDescription>
          <a
            className="mt-4 inline-flex min-h-11 items-center text-info underline"
            href={stepUpAuthenticationPath('/admin/step-up', '')}
            target="_blank"
            rel="noopener noreferrer"
            onClick={startReauthentication}
          >
            Sign in through Hub
          </a>
          {message && <output className="mt-3 block text-sm">{message}</output>}
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
