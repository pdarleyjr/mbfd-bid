import { cookies } from 'next/headers';
import { JWT_COOKIE_NAME } from './cookies';
import { createRpcClient } from './rpc-client';
import { getWorkerBase } from './worker-base';

export async function getServerRpc() {
  const cookieStore = await cookies();
  const jwt = cookieStore.get(JWT_COOKIE_NAME)?.value;
  return createRpcClient(getWorkerBase(), jwt);
}
