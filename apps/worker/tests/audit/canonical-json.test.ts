import { describe, expect, it } from 'vitest';

import { canonicalize } from '../../src/audit/canonical-json.js';

describe('canonicalize (RFC 8785 / JCS)', () => {
  it('sorts object keys lexicographically', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('produces no whitespace', () => {
    expect(canonicalize({ a: [1, 2, 3] })).toBe('{"a":[1,2,3]}');
  });

  it('is byte-stable regardless of key insertion order', () => {
    const a = { x: 1, y: { p: 2, q: 3 }, z: [3, 1, 2] };
    const b = { z: [3, 1, 2], y: { q: 3, p: 2 }, x: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('preserves array order (arrays are NOT sorted)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('escapes JSON-required characters in strings', () => {
    expect(canonicalize({ s: 'a"b\\c\n' })).toBe('{"s":"a\\"b\\\\c\\n"}');
  });

  it('serializes null + booleans', () => {
    expect(canonicalize({ x: null, t: true, f: false })).toBe('{"f":false,"t":true,"x":null}');
  });

  it('throws on NaN, Infinity, undefined', () => {
    expect(() => canonicalize({ x: Number.NaN })).toThrow(/NaN/);
    expect(() => canonicalize({ x: Number.POSITIVE_INFINITY })).toThrow(/Infinity/);
    expect(() => canonicalize({ x: undefined as unknown as null })).toThrow(/undefined/);
  });

  it('audit event shape has sorted keys', () => {
    const evt = {
      action: 'pick',
      actor_id: 42,
      actor_type: 'member',
      bid_session_id: '01HF3',
      seq: 17,
      target_id: 'A101',
    };
    expect(canonicalize(evt)).toBe(
      '{"action":"pick","actor_id":42,"actor_type":"member","bid_session_id":"01HF3","seq":17,"target_id":"A101"}',
    );
  });
});
