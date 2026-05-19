// Plan 09 Task 4 — Security headers tests.
//
// applySecurityHeaders mutates a Headers object in place and sets the
// following seven headers:
//   1. content-security-policy
//   2. strict-transport-security
//   3. x-content-type-options
//   4. x-frame-options
//   5. referrer-policy
//   6. permissions-policy
//   7. cross-origin-opener-policy

import { describe, expect, it } from 'vitest';

import { applySecurityHeaders } from '../../src/middleware/security-headers.js';

describe('applySecurityHeaders', () => {
  it('sets the seven required headers with the documented values', () => {
    const headers = new Headers();
    applySecurityHeaders(headers);

    expect(headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('strict-transport-security')).toContain('max-age=31536000');
    expect(headers.get('strict-transport-security')).toContain('includeSubDomains');
    expect(headers.get('strict-transport-security')).toContain('preload');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
    expect(headers.get('permissions-policy')).toContain('camera=()');
    expect(headers.get('permissions-policy')).toContain('microphone=()');
    expect(headers.get('permissions-policy')).toContain('geolocation=()');
    expect(headers.get('permissions-policy')).toContain('payment=()');
    expect(headers.get('cross-origin-opener-policy')).toBe('same-origin');
  });

  it('is idempotent — applying twice leaves the same values', () => {
    const headers = new Headers();
    applySecurityHeaders(headers);
    const before = Object.fromEntries(headers.entries());
    applySecurityHeaders(headers);
    const after = Object.fromEntries(headers.entries());
    expect(after).toEqual(before);
  });

  it('does not clobber unrelated headers', () => {
    const headers = new Headers({ 'x-trace-id': 'abc' });
    applySecurityHeaders(headers);
    expect(headers.get('x-trace-id')).toBe('abc');
  });
});
