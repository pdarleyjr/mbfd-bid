// Plan 08 Task 14 — HMAC print-token (worker side: mint + verify).
//
// The token authorizes a single render of the web RSC roster page by
// Browserless. The web side has its own `verifyPrintToken` helper using the
// same algorithm — both sides share the `PRINT_TOKEN_SECRET`.
//
// Encoding: <base64url(JSON(claims))>.<hex(HMAC-SHA256(body))>
// TTL: 5 minutes (configurable per-call).

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

const enc = new TextEncoder();

function base64UrlEncode(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): string {
  const pad = '==='.slice((s.length + 3) % 4);
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

export function mintPrintToken(
  claims: Omit<PrintTokenClaims, 'exp'>,
  secret: string,
  ttlSec = 300,
  nowMs: number = Date.now(),
): string {
  const full: PrintTokenClaims = {
    ...claims,
    exp: Math.floor(nowMs / 1000) + ttlSec,
  };
  const body = base64UrlEncode(JSON.stringify(full));
  const sig = bytesToHex(hmac(sha256, enc.encode(secret), enc.encode(body)));
  return `${body}.${sig}`;
}

export function verifyPrintToken(
  token: string,
  secret: string,
  expected: Omit<PrintTokenClaims, 'exp'>,
  nowMs: number = Date.now(),
): boolean {
  const [body, sig] = token.split('.');
  if (!body || !sig) return false;
  let claims: PrintTokenClaims;
  try {
    claims = JSON.parse(base64UrlDecode(body));
  } catch {
    return false;
  }
  if (claims.exp < Math.floor(nowMs / 1000)) return false;
  if (claims.kind !== expected.kind) return false;
  if (claims.session_id !== expected.session_id) return false;
  if (expected.shift && claims.shift !== expected.shift) return false;
  const recomputed = bytesToHex(hmac(sha256, enc.encode(secret), enc.encode(body)));
  if (recomputed.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= recomputed.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
