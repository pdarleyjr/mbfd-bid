import { describe, expect, it } from 'vitest';

import { createSignedR2Url } from '../../src/exports/signed-url.js';

describe('createSignedR2Url (Plan 08 Task 16)', () => {
  it('produces a URL with the AWS4-HMAC-SHA256 query signature', async () => {
    const url = await createSignedR2Url({
      bucket: 'mbfd-bid-exports-staging',
      key: '2026/01HF3/audit_full_123.csv.gz',
      accessKeyId: 'AKIA_FAKE',
      secretAccessKey: 'SECRET_FAKE_VERY_FAKE',
      accountId: 'CFACC_FAKE',
      ttlSec: 600,
      now: () => new Date('2026-09-22T14:00:00Z'),
    });
    const u = new URL(url);
    // `URL.hostname` is case-folded to lowercase by the WHATWG parser; we
    // assert lowercase here even though the original input was uppercase.
    expect(u.hostname).toBe('cfacc_fake.r2.cloudflarestorage.com');
    expect(u.pathname).toBe('/mbfd-bid-exports-staging/2026/01HF3/audit_full_123.csv.gz');
    expect(u.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different keys produce different signatures', async () => {
    const base = {
      bucket: 'b',
      accessKeyId: 'k',
      secretAccessKey: 's',
      accountId: 'a',
      ttlSec: 60,
      now: () => new Date('2026-09-22T14:00:00Z'),
    };
    const u1 = await createSignedR2Url({ ...base, key: 'one' });
    const u2 = await createSignedR2Url({ ...base, key: 'two' });
    expect(new URL(u1).searchParams.get('X-Amz-Signature')).not.toBe(
      new URL(u2).searchParams.get('X-Amz-Signature'),
    );
  });

  it('same key + secret produces stable signature (deterministic)', async () => {
    const args = {
      bucket: 'b',
      key: 'one',
      accessKeyId: 'k',
      secretAccessKey: 's',
      accountId: 'a',
      ttlSec: 60,
      now: () => new Date('2026-09-22T14:00:00Z'),
    };
    const u1 = await createSignedR2Url(args);
    const u2 = await createSignedR2Url(args);
    expect(u1).toBe(u2);
  });
});
