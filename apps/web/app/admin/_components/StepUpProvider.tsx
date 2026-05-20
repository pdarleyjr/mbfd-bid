'use client';

import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

interface StepUpProviderProps {
  children: ReactNode;
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

type Resolver = {
  resolve: () => void;
  reject: (err: Error) => void;
};

function isAdminApiRequest(input: FetchInput): boolean {
  const url =
    input instanceof Request
      ? new URL(input.url, window.location.origin)
      : new URL(String(input), window.location.origin);
  return url.origin === window.location.origin && url.pathname.startsWith('/api/admin/');
}

function cloneInput(input: FetchInput): FetchInput {
  return input instanceof Request ? (input.clone() as FetchInput) : input;
}

function cloneInit(init?: FetchInit): FetchInit {
  if (!init) return undefined;
  const copy = { ...init };
  if (init.headers) copy.headers = new Headers(init.headers);
  return copy;
}

export function StepUpProvider({ children }: StepUpProviderProps) {
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const resolver = useRef<Resolver | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const requestStepUp = useCallback((): Promise<void> => {
    if (pending.current) return pending.current;
    setOpen(true);
    setError(null);
    setPassword('');
    pending.current = new Promise<void>((resolve, reject) => {
      resolver.current = { resolve, reject };
    }).finally(() => {
      pending.current = null;
      resolver.current = null;
    });
    return pending.current;
  }, []);

  const requestStepUpRef = useRef(requestStepUp);
  useEffect(() => {
    requestStepUpRef.current = requestStepUp;
  }, [requestStepUp]);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: FetchInput, init?: FetchInit): Promise<Response> => {
      if (!isAdminApiRequest(input)) return originalFetch(input, init);

      const retryInput = cloneInput(input);
      const retryInit = cloneInit(init);
      const response = await originalFetch(input, init);
      if (response.status !== 401) return response;

      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as { error?: string } | null;
      if (body?.error !== 'step_up_required') return response;

      try {
        await requestStepUpRef.current();
      } catch {
        return response;
      }
      return originalFetch(retryInput, retryInit);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  useEffect(() => {
    if (open) passwordRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/step-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId.trim(), password }),
      });
      if (!res.ok) {
        setError(
          res.status === 401 ? 'Incorrect employee ID or password.' : 'Could not re-authenticate.',
        );
        return;
      }
      setOpen(false);
      resolver.current?.resolve();
    } catch {
      setError('Could not reach the authentication service.');
    } finally {
      setBusy(false);
    }
  }

  function onCancel() {
    setOpen(false);
    resolver.current?.reject(new Error('step_up_cancelled'));
  }

  return (
    <>
      {children}
      {open && (
        <dialog
          open
          className="fixed inset-0 z-50 m-0 flex h-dvh w-dvw max-w-none items-center justify-center border-0 bg-slate-950/70 px-4 text-left"
          aria-modal="true"
          aria-labelledby="step-up-title"
          aria-describedby="step-up-description"
        >
          <form
            onSubmit={onSubmit}
            className="w-full max-w-sm rounded-lg border border-stone-300 bg-stone-50 p-5 text-stone-900 shadow-xl"
          >
            <h2 id="step-up-title" className="font-heading text-lg">
              Confirm admin action
            </h2>
            <p id="step-up-description" className="mt-1 text-sm text-stone-600">
              Re-enter admin credentials to continue with this protected action.
            </p>
            <label className="mt-4 block text-sm">
              <span className="font-medium text-stone-700">Employee ID</span>
              <input
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                autoComplete="username"
                className="mt-1 block min-h-11 w-full rounded border border-stone-300 bg-white px-3 text-stone-900 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-700"
                required
              />
            </label>
            <label className="mt-3 block text-sm">
              <span className="font-medium text-stone-700">Password</span>
              <input
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="mt-1 block min-h-11 w-full rounded border border-stone-300 bg-white px-3 text-stone-900 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-700"
                required
              />
            </label>
            {error && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="min-h-10 rounded border border-stone-300 px-4 text-sm font-medium text-stone-700 hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || password.length === 0 || employeeId.trim().length === 0}
                className="min-h-10 rounded bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                {busy ? 'Checking...' : 'Continue'}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
