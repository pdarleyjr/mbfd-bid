// Plan 08 Task 13 — Print-token verification (web side).
//
// Browserless hits the public render URL with a short-lived (5 min) HMAC
// token minted by the worker. The web RSC page verifies before fetching the
// roster data and rendering. The signing secret is shared between worker
// (PRINT_TOKEN_SECRET secret) and web (PRINT_TOKEN_SECRET env var).

import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export interface PrintTokenClaims {
  kind: 'roster' | 'audit-csv';
  shift?: 'A' | 'B' | 'C' | 'D';
  session_id: string;
  /** Unix seconds. */
  exp: number;
}

function base64UrlDecode(s: string): string {
  const pad = '==='.slice((s.length + 3) % 4);
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return atob(b64);
}

export async function verifyPrintToken(
  token: string | undefined,
  expected: Omit<PrintTokenClaims, 'exp'>,
  secret: string | undefined = process.env.PRINT_TOKEN_SECRET,
): Promise<boolean> {
  if (!token || !secret) return false;
  const [body, sig] = token.split('.');
  if (!body || !sig) return false;
  let claims: PrintTokenClaims;
  try {
    claims = JSON.parse(base64UrlDecode(body));
  } catch {
    return false;
  }
  if (claims.exp < Math.floor(Date.now() / 1000)) return false;
  if (claims.kind !== expected.kind) return false;
  if (claims.session_id !== expected.session_id) return false;
  if (expected.shift && claims.shift !== expected.shift) return false;
  const recomputed = bytesToHex(
    hmac(sha256, new TextEncoder().encode(secret), new TextEncoder().encode(body)),
  );
  // Constant-time comparison — short string but cheap.
  if (recomputed.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= recomputed.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}
