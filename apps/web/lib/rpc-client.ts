// Type-only import from the worker for AppType schema inference.
// Note: cross-package Hono type inference is limited when pnpm isolates
// node_modules per package (the `Hono` class identity differs between
// apps/worker/node_modules/hono and apps/web/node_modules/hono at the
// unique-symbol level, causing `Client<AppType>` to resolve to `never`
// inside web's tsc). We therefore expose `WorkerClient` as `any` for
// now and rely on the type-path checks in the tests being compile-time
// validated when both packages share the same hono instance (e.g. in CI
// with deduplication or when the worker is built to .d.ts).
import type { AppType as _AppType } from '@mbfd/worker';
import { type ClientRequestOptions, hc } from 'hono/client';

// biome-ignore lint/suspicious/noExplicitAny: escape hatch — see module comment
export type WorkerClient = ReturnType<typeof hc<any>>;

export function createRpcClient(baseUrl: string, jwt?: string): WorkerClient {
  const opts: ClientRequestOptions = jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : {};
  // biome-ignore lint/suspicious/noExplicitAny: escape hatch — see module comment
  return hc<any>(baseUrl, opts);
}
