// Plan 08 Task 6 — ed25519 chunk signer.
//
// Signs the lowercase hex chunk hash with the session's ed25519 private key
// (Wrangler secret `AUDIT_SIGNING_PRIVKEY`). The signature is base64url for
// JSON safety. Verification uses the public key embedded in the chunk header
// so a verifier never needs an external key lookup.
//
// Crypto choice: `@noble/ed25519` is small, audited, and Worker-compatible
// where Node `crypto` is not.

import * as ed from '@noble/ed25519';

const enc = new TextEncoder();

/** Encode arbitrary bytes (32-byte keys or 64-byte signatures) as base64url, no padding. */
export function encodeKey(raw: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < raw.length; i++) bin += String.fromCharCode(raw[i] as number);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode base64url (with or without padding) back to bytes. */
export function decodeKey(b64u: string): Uint8Array {
  const padded = b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Sign the lowercase-hex chunk hash. We sign the hex *string bytes*, not the
 * raw digest, because the chunk header records the hash as hex — signing
 * the same bytes the header carries means the verifier can sign-check
 * directly from the header without re-hashing first.
 */
export async function signChunk(chunkHashHex: string, privKeyB64u: string): Promise<string> {
  const priv = decodeKey(privKeyB64u);
  const sig = await ed.signAsync(enc.encode(chunkHashHex), priv);
  return encodeKey(sig);
}

/** Returns true iff the signature is a valid ed25519 sig for the given hash + pubkey. */
export async function verifyChunkSignature(
  chunkHashHex: string,
  signatureB64u: string,
  pubKeyB64u: string,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(
      decodeKey(signatureB64u),
      enc.encode(chunkHashHex),
      decodeKey(pubKeyB64u),
    );
  } catch {
    return false;
  }
}
