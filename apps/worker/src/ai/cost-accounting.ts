import type { KVNamespace } from '@cloudflare/workers-types';

export const COST_KEY_PREFIX = 'ai_cost_cents:';
const TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days — bid + report period

/** Atomic-ish add (KV does not support increments; we read-modify-write). */
export async function addSessionCostCents(
  kv: KVNamespace,
  bidSessionId: string,
  deltaCents: number,
): Promise<number> {
  const key = COST_KEY_PREFIX + bidSessionId;
  const current = await kv.get(key);
  const next = (current ? Number(current) : 0) + deltaCents;
  await kv.put(key, String(next), { expirationTtl: TTL_SECONDS });
  return next;
}

export async function getSessionCostCents(kv: KVNamespace, bidSessionId: string): Promise<number> {
  const v = await kv.get(COST_KEY_PREFIX + bidSessionId);
  return v ? Number(v) : 0;
}
