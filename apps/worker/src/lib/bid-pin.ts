/**
 * Member bid-page access PIN — stored in KV under a single key so both the
 * staging bid site (admin settings UI) and the MBFD Hub Filament admin can
 * mutate it. Reads on `/api/auth/verify-pin` and writes on either of the
 * admin surfaces all go through these helpers, so the two sides stay in
 * lockstep automatically.
 *
 * Default value: "2300" — used when the key is unset (e.g. fresh deploy or
 * after a `wrangler kv:key delete`). Storing the default explicitly is not
 * required; verifyPin falls back to it.
 */

import type { KVNamespace } from '@cloudflare/workers-types';

export const DEFAULT_MEMBER_BID_PIN = '2300';
export const MEMBER_BID_PIN_KV_KEY = 'settings:member_bid_pin';

export interface BidPinSetting {
  /** 4–8 digit access PIN. */
  pin: string;
  /** Epoch milliseconds of last write; 0 when unset (default). */
  updatedAt: number;
  /** member id / employee id / 'system' for the last writer. */
  updatedBy: string | null;
}

const PIN_RE = /^\d{4,8}$/;

export function isValidPin(value: unknown): value is string {
  return typeof value === 'string' && PIN_RE.test(value);
}

/**
 * Read the current bid-page PIN. Falls back to the compile-time default when
 * KV is empty or holds malformed JSON. Always resolves — never throws — so
 * the verify-pin endpoint can stay simple.
 */
export async function getBidPin(kv: KVNamespace): Promise<BidPinSetting> {
  const fallback: BidPinSetting = {
    pin: DEFAULT_MEMBER_BID_PIN,
    updatedAt: 0,
    updatedBy: null,
  };
  let raw: string | null = null;
  try {
    raw = await kv.get(MEMBER_BID_PIN_KV_KEY);
  } catch (err) {
    console.error('[bid-pin] KV read failed (using default)', err);
    return fallback;
  }
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<BidPinSetting>;
    if (!isValidPin(parsed.pin)) return fallback;
    return {
      pin: parsed.pin,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      updatedBy: typeof parsed.updatedBy === 'string' ? parsed.updatedBy : null,
    };
  } catch {
    return fallback;
  }
}

/**
 * Write a new bid-page PIN. Throws `Error('invalid_pin')` if the value
 * doesn't match the 4–8 digit shape — callers should validate upstream and
 * return 400 on the wire.
 */
export async function setBidPin(
  kv: KVNamespace,
  pin: string,
  updatedBy: string,
): Promise<BidPinSetting> {
  if (!isValidPin(pin)) {
    throw new Error('invalid_pin');
  }
  const setting: BidPinSetting = {
    pin,
    updatedAt: Date.now(),
    updatedBy,
  };
  await kv.put(MEMBER_BID_PIN_KV_KEY, JSON.stringify(setting));
  return setting;
}

/**
 * Constant-time-ish string compare. Both inputs are short numeric strings,
 * but we still want to avoid leaking length via early-exit.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
