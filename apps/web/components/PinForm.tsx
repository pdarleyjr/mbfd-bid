'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function PinForm() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        // Cast: `/login` is added in Task 9. Until then typedRoutes can't
        // verify it, so we cast to bypass the route type check.
        router.push('/login' as never);
        router.refresh();
      } else if (res.status === 401) {
        setError('Incorrect PIN.');
      } else {
        setError('Could not verify PIN. Try again.');
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <label className="block">
        <span className="block text-sm font-medium text-stone-700">Access PIN</span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          required
          minLength={4}
          maxLength={8}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? 'pin-error' : undefined}
          className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-3 font-mono text-lg tracking-widest text-stone-800 shadow-sm outline-none transition duration-base ease-out-quart focus:border-red-700 focus:ring-2 focus:ring-red-700"
        />
      </label>
      {error && (
        <p id="pin-error" role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || pin.length < 4}
        className="inline-flex w-full items-center justify-center rounded-lg bg-red-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition duration-base ease-out-quart hover:bg-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Verifying…' : 'Continue'}
      </button>
    </form>
  );
}
