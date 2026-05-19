// Plan 08 Task 16 — AWS SigV4 query-string signed URL for R2 (GET only).
//
// R2's S3-compatible endpoint accepts standard AWS SigV4 query-string signed
// URLs. We implement just the GET-presigned variant since downloads are the
// only thing we sign; uploads go through the worker binding directly.
//
// Secrets required:
//   R2_ACCESS_KEY_ID       Cloudflare R2 access key
//   R2_SECRET_ACCESS_KEY   Cloudflare R2 secret access key
//   R2_ACCOUNT_ID          Cloudflare account ID
//
// Generated via Cloudflare dashboard → R2 → Manage API tokens.

import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

const enc = new TextEncoder();

export interface SignedUrlArgs {
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  accountId: string;
  /** Lifetime in seconds — AWS caps this at 604_800 (7 days). */
  ttlSec: number;
  now: () => Date;
}

export async function createSignedR2Url(a: SignedUrlArgs): Promise<string> {
  const now = a.now();
  const amzDate = toAmzDate(now); // 20260922T140000Z
  const dateStamp = amzDate.slice(0, 8); // 20260922
  const region = 'auto';
  const service = 's3';
  const host = `${a.accountId}.r2.cloudflarestorage.com`;
  const path = `/${a.bucket}/${a.key.split('/').map(encodeURIComponent).join('/')}`;
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const qsObj: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${a.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(a.ttlSec),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQs = Object.keys(qsObj)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(qsObj[k] as string)}`)
    .join('&');
  const canonicalRequest = [
    'GET',
    path,
    canonicalQs,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const hashedCanon = bytesToHex(sha256(enc.encode(canonicalRequest)));
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hashedCanon].join('\n');

  const kDate = hmac(sha256, enc.encode(`AWS4${a.secretAccessKey}`), enc.encode(dateStamp));
  const kRegion = hmac(sha256, kDate, enc.encode(region));
  const kService = hmac(sha256, kRegion, enc.encode(service));
  const kSigning = hmac(sha256, kService, enc.encode('aws4_request'));
  const signature = bytesToHex(hmac(sha256, kSigning, enc.encode(stringToSign)));

  return `https://${host}${path}?${canonicalQs}&X-Amz-Signature=${signature}`;
}

function toAmzDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
    d.getUTCHours(),
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
