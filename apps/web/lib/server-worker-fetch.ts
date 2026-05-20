import { cookies } from 'next/headers';
import { JWT_COOKIE_NAME } from './cookies';
import { getWorkerBase } from './worker-base';

export async function serverWorkerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const jwt = (await cookies()).get(JWT_COOKIE_NAME)?.value;
  const headers = new Headers(init.headers);
  if (jwt) headers.set('authorization', `Bearer ${jwt}`);

  return fetch(`${getWorkerBase()}${path}`, {
    ...init,
    headers,
  });
}
