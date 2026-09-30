import { describe, expect, it } from 'vitest';
import {
  decodeBidEvidenceDocument,
  encodeBidEvidenceDocument,
} from '../../src/lib/bid-evidence-storage.js';

describe('immutable evidence document storage', () => {
  const json = JSON.stringify({
    events: Array.from({ length: 40_000 }, (_, id) => ({
      id,
      source: 'Synthetic dated qualification evidence',
      effectiveOn: '2026-01-01',
      expiresOn: '2027-01-01',
      operator: 'Synthetic accented name: García — evidence',
    })),
  });

  it('preserves a document above the D1 row limit byte for byte', () => {
    expect(new TextEncoder().encode(json).length).toBeGreaterThan(2_000_000);
    const stored = encodeBidEvidenceDocument(json);
    expect(new TextEncoder().encode(stored).length).toBeLessThan(2_000_000);
    expect(decodeBidEvidenceDocument(stored)).toBe(json);
  });

  it('keeps existing uncompressed evidence readable without rewriting it', () => {
    const legacy = JSON.stringify({ members: [], settings: { v: 3 } });
    expect(encodeBidEvidenceDocument(legacy)).toBe(legacy);
    expect(decodeBidEvidenceDocument(legacy)).toBe(legacy);
  });

  it.each(['size', 'digest', 'encoding'] as const)('rejects changed %s metadata', (kind) => {
    const envelope = JSON.parse(encodeBidEvidenceDocument(json));
    if (kind === 'size') envelope.uncompressedBytes -= 1;
    if (kind === 'digest') envelope.sha256 = '0'.repeat(64);
    if (kind === 'encoding') envelope.format = 'unsupported-evidence-format';
    expect(() => decodeBidEvidenceDocument(JSON.stringify(envelope))).toThrow();
  });

  it('rejects malformed compressed data and prevents unbounded expansion', () => {
    const envelope = JSON.parse(encodeBidEvidenceDocument(json));
    expect(() =>
      decodeBidEvidenceDocument(JSON.stringify({ ...envelope, data: 'AAAA' })),
    ).toThrow();
    expect(() =>
      decodeBidEvidenceDocument(JSON.stringify({ ...envelope, uncompressedBytes: 1 })),
    ).toThrow();
    expect(() =>
      decodeBidEvidenceDocument(JSON.stringify({ ...envelope, uncompressedBytes: 32_000_001 })),
    ).toThrow();
  });
});
