import { describe, expect, it } from 'vitest';
import { nextVersion, parseVersion } from '../../src/lib/rule-book-version.js';

describe('parseVersion', () => {
  it('parses 2026.1 into { year: 2026, n: 1 }', () => {
    expect(parseVersion('2026.1')).toEqual({ year: 2026, n: 1 });
  });

  it('parses 2026.17 into { year: 2026, n: 17 }', () => {
    expect(parseVersion('2026.17')).toEqual({ year: 2026, n: 17 });
  });

  it('returns null for malformed input', () => {
    expect(parseVersion('v2026.1')).toBeNull();
    expect(parseVersion('2026')).toBeNull();
    expect(parseVersion('2026.1.2')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('two-thousand.one')).toBeNull();
  });

  it('returns null when n is zero or negative', () => {
    expect(parseVersion('2026.0')).toBeNull();
    expect(parseVersion('2026.-1')).toBeNull();
  });
});

describe('nextVersion', () => {
  it('returns "<year>.1" when there are no existing versions for year', () => {
    expect(nextVersion(2026, [])).toBe('2026.1');
  });

  it('returns "<year>.<max+1>" given existing versions for that year', () => {
    expect(nextVersion(2026, ['2026.1', '2026.2', '2026.3'])).toBe('2026.4');
  });

  it('ignores versions from a different year', () => {
    expect(nextVersion(2026, ['2025.5', '2024.10'])).toBe('2026.1');
  });

  it('ignores malformed strings in the input list', () => {
    expect(nextVersion(2026, ['2026.1', 'garbage', '2026.foo', '2026.2'])).toBe('2026.3');
  });

  it('handles a sparse list (gap) correctly — picks max+1, not first-missing', () => {
    expect(nextVersion(2026, ['2026.1', '2026.5'])).toBe('2026.6');
  });
});
