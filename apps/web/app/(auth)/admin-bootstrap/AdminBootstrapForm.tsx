'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Staging-only entrypoint for an independently authenticated local admin to
 * initialize the member PIN when its canonical KV record does not yet exist.
 */
export function AdminBootstrapForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const response = await fetch('/api/auth/bootstrap-pin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, pin }),
      }).catch(() => null);

      if (response?.ok) {
        setPassword('');
        setPin('');
        router.replace('/');
        router.refresh();
        return;
      }

      setError(
        response?.status === 401 || response?.status === 403
          ? 'Incorrect staging admin password.'
          : response?.status === 400
            ? 'PIN must be 4–8 digits.'
            : 'Could not initialize the staging PIN.',
      );
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
      <label className="block">
        <span className="block text-sm font-medium text-stone-700">Staging admin password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-3 text-base text-stone-800 shadow-sm outline-none transition duration-base ease-out-quart focus:border-red-700 focus:ring-2 focus:ring-red-700"
        />
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-stone-700">New member PIN</span>
        <input
          type="password"
          inputMode="numeric"
          pattern="\\d{4,8}"
          minLength={4}
          maxLength={8}
          autoComplete="off"
          required
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
          className="mt-1 block w-40 rounded-lg border border-stone-200 bg-white px-3 py-3 font-mono text-lg tracking-widest text-stone-800 shadow-sm outline-none transition duration-base ease-out-quart focus:border-red-700 focus:ring-2 focus:ring-red-700"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || password.length === 0 || !/^\d{4,8}$/.test(pin)}
        className="inline-flex w-full items-center justify-center rounded-lg bg-red-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition duration-base ease-out-quart hover:bg-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Initialize PIN'}
      </button>
    </form>
  );
}
