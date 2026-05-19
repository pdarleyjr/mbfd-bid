import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { describe, expect, it } from 'vitest';

import { type PrintTokenClaims, verifyPrintToken } from '../../lib/print-token';

const SECRET = 'test-secret-123';

function mintToken(claims: PrintTokenClaims, secret: string = SECRET): string {
  const body = btoa(JSON.stringify(claims))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const sig = bytesToHex(
    hmac(sha256, new TextEncoder().encode(secret), new TextEncoder().encode(body)),
  );
  return `${body}.${sig}`;
}

describe('verifyPrintToken (Plan 08 Task 13)', () => {
  const future = Math.floor(Date.now() / 1000) + 60;
  const past = Math.floor(Date.now() / 1000) - 60;

  it('accepts a valid roster token', async () => {
    const token = mintToken({ kind: 'roster', shift: 'A', session_id: '01HF3', exp: future });
    expect(
      await verifyPrintToken(token, { kind: 'roster', shift: 'A', session_id: '01HF3' }, SECRET),
    ).toBe(true);
  });

  it('rejects expired token', async () => {
    const token = mintToken({ kind: 'roster', shift: 'A', session_id: '01HF3', exp: past });
    expect(
      await verifyPrintToken(token, { kind: 'roster', shift: 'A', session_id: '01HF3' }, SECRET),
    ).toBe(false);
  });

  it('rejects shift mismatch', async () => {
    const token = mintToken({ kind: 'roster', shift: 'A', session_id: '01HF3', exp: future });
    expect(
      await verifyPrintToken(token, { kind: 'roster', shift: 'B', session_id: '01HF3' }, SECRET),
    ).toBe(false);
  });

  it('rejects session mismatch', async () => {
    const token = mintToken({ kind: 'roster', shift: 'A', session_id: '01HF3', exp: future });
    expect(
      await verifyPrintToken(token, { kind: 'roster', shift: 'A', session_id: 'OTHER' }, SECRET),
    ).toBe(false);
  });

  it('rejects forged signature (wrong secret)', async () => {
    const token = mintToken({ kind: 'roster', shift: 'A', session_id: '01HF3', exp: future });
    expect(
      await verifyPrintToken(
        token,
        { kind: 'roster', shift: 'A', session_id: '01HF3' },
        'different-secret',
      ),
    ).toBe(false);
  });

  it('rejects malformed token', async () => {
    expect(
      await verifyPrintToken('bogus', { kind: 'roster', shift: 'A', session_id: '01HF3' }, SECRET),
    ).toBe(false);
    expect(
      await verifyPrintToken(
        undefined,
        { kind: 'roster', shift: 'A', session_id: '01HF3' },
        SECRET,
      ),
    ).toBe(false);
  });
});
