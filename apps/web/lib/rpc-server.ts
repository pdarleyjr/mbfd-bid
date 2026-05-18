import { cookies } from 'next/headers';
import { cfEnv } from './cf-env';
import { JWT_COOKIE_NAME } from './cookies';
import { createRpcClient } from './rpc-client';

export async function getServerRpc() {
  const cookieStore = await cookies();
  const jwt = cookieStore.get(JWT_COOKIE_NAME)?.value;
  const baseUrl = cfEnv('WORKER_URL') ?? 'http://localhost:8787';
  return createRpcClient(baseUrl, jwt);
}
