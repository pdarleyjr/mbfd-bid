import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PIN_COOKIE_NAME } from './cookies';

/**
 * Server-Component-side PIN gate. Redirects to / when the PIN cookie is
 * absent or doesn't equal "ok". Replaces the global middleware.ts gate
 * which OpenNext 1.x can't bundle reliably (dynamic-require of the
 * middleware-manifest at runtime).
 */
export async function requirePin(): Promise<void> {
  const store = await cookies();
  if (store.get(PIN_COOKIE_NAME)?.value !== 'ok') {
    redirect('/');
  }
}
