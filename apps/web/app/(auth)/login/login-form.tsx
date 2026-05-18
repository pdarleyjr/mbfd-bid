'use client';

import { LoginRequestSchema } from '@mbfd/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function LoginForm() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = LoginRequestSchema.safeParse({
      employee_id: employeeId.trim(),
      password,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    startTransition(async () => {
      const apiBase = process.env.NEXT_PUBLIC_WORKER_BASE ?? '';
      const res = await fetch(`${apiBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        const body = (await res.json()) as { jwt: string };
        // Hand off to web app's /api/auth/session-finalize to set the HTTP-only cookie (Task 10)
        const finalize = await fetch('/api/auth/session-finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jwt: body.jwt }),
        });
        if (!finalize.ok) {
          setError('Could not finalize session. Try again.');
          return;
        }
        // Cast: '/lobby' is created in Task 10
        router.push('/lobby' as never);
        router.refresh();
      } else if (res.status === 401) {
        setError('Incorrect employee ID or password.');
      } else if (res.status === 503) {
        setError('Portal is unreachable. Contact IT.');
      } else {
        setError('Login failed. Try again.');
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <label className="block">
        <span className="block text-sm font-medium text-stone-700">Employee ID</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="username"
          required
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-3 font-mono text-base text-stone-800 shadow-sm outline-none transition duration-base ease-out-quart focus:border-red-700 focus:ring-2 focus:ring-red-700"
        />
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-stone-700">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-3 text-base text-stone-800 shadow-sm outline-none transition duration-base ease-out-quart focus:border-red-700 focus:ring-2 focus:ring-red-700"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !employeeId.trim() || password.length < 6}
        className="inline-flex w-full items-center justify-center rounded-lg bg-red-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition duration-base ease-out-quart hover:bg-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
