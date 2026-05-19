import * as ed from '@noble/ed25519';
import { bytesToHex } from '@noble/hashes/utils';
import { beforeAll, describe, expect, it } from 'vitest';

import { decodeKey, encodeKey, signChunk, verifyChunkSignature } from '../../src/audit/signer.js';

describe('signer', () => {
  let priv: Uint8Array;
  let pub: Uint8Array;

  beforeAll(async () => {
    priv = ed.utils.randomPrivateKey();
    pub = await ed.getPublicKeyAsync(priv);
  });

  it('signChunk produces 64-byte signature (base64url)', async () => {
    const sig = await signChunk('a'.repeat(64), encodeKey(priv));
    expect(decodeKey(sig).length).toBe(64);
  });

  it('verifyChunkSignature accepts valid signature', async () => {
    const hash = bytesToHex(new Uint8Array(32).fill(0xab));
    const sig = await signChunk(hash, encodeKey(priv));
    expect(await verifyChunkSignature(hash, sig, encodeKey(pub))).toBe(true);
  });

  it('verifyChunkSignature rejects forged signature (wrong key)', async () => {
    const hash = bytesToHex(new Uint8Array(32).fill(0xab));
    const sig = await signChunk(hash, encodeKey(priv));
    const otherPriv = ed.utils.randomPrivateKey();
    const otherPub = await ed.getPublicKeyAsync(otherPriv);
    expect(await verifyChunkSignature(hash, sig, encodeKey(otherPub))).toBe(false);
  });

  it('verifyChunkSignature rejects tampered hash', async () => {
    const h1 = bytesToHex(new Uint8Array(32).fill(0xab));
    const sig = await signChunk(h1, encodeKey(priv));
    const h2 = bytesToHex(new Uint8Array(32).fill(0xac));
    expect(await verifyChunkSignature(h2, sig, encodeKey(pub))).toBe(false);
  });

  it('encodeKey / decodeKey round-trip', () => {
    const k = new Uint8Array(32);
    crypto.getRandomValues(k);
    const encoded = encodeKey(k);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeKey(encoded)).toEqual(k);
  });
});
