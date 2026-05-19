// Plan 08 Task 20 — Portal HTTP client.
//
//   POST {portalBaseUrl}/api/v2/members/{employeeId}/bid-assignment
//
// Result classification:
//   200, 409 → synced (409 = portal-side idempotency hit; treat as success)
//   5xx, network error, timeout → transient (will be retried)
//   4xx (other than 409) → permanent (won't be retried; admin must fix)

import type { PortalPayload } from '@mbfd/shared';

export type PostResult =
  | { kind: 'synced'; statusCode: number }
  | { kind: 'transient'; statusCode: number | null; message: string }
  | { kind: 'permanent'; statusCode: number; message: string };

export interface PostArgs {
  employeeId: string;
  payload: PortalPayload;
  portalBaseUrl: string;
  token: string;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
}

export async function postBidAssignment(a: PostArgs): Promise<PostResult> {
  const url = `${a.portalBaseUrl}/api/v2/members/${encodeURIComponent(
    a.employeeId,
  )}/bid-assignment`;
  const timeoutMs = a.timeoutMs ?? 10_000;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await a.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${a.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(a.payload),
      signal: ctrl.signal,
    });
    if (res.status === 200 || res.status === 409) {
      return { kind: 'synced', statusCode: res.status };
    }
    if (res.status >= 500) {
      const msg = await res.text().catch(() => '');
      return { kind: 'transient', statusCode: res.status, message: msg };
    }
    if (res.status >= 400) {
      const msg = await res.text().catch(() => '');
      return { kind: 'permanent', statusCode: res.status, message: `${res.status}: ${msg}` };
    }
    return { kind: 'transient', statusCode: res.status, message: 'unexpected status' };
  } catch (e) {
    return { kind: 'transient', statusCode: null, message: (e as Error).message };
  } finally {
    clearTimeout(timeout);
  }
}
