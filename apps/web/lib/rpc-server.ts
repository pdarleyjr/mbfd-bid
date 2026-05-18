import { cookies } from 'next/headers';
import { JWT_COOKIE_NAME } from './cookies.js';
import { createRpcClient } from './rpc-client.js';

export async function getServerRpc() {
  const cookieStore = await cookies();
  const jwt = cookieStore.get(JWT_COOKIE_NAME)?.value;
  const baseUrl = process.env.WORKER_URL ?? 'http://localhost:8787';
  return createRpcClient(baseUrl, jwt);
}
