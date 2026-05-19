import { describe, expect, it } from 'vitest';
import { formatET, parseEtLocalInput, toEtIso } from '../../lib/et-time';

describe('formatET', () => {
  it('formats a UTC date as ET (EST in January)', () => {
    // 2026-01-15T14:30:00Z = 09:30 EST
    expect(formatET(new Date('2026-01-15T14:30:00.000Z'), 'time')).toBe('09:30 AM');
  });

  it('formats a UTC date as ET (EDT in July)', () => {
    // 2026-07-15T14:30:00Z = 10:30 EDT
    expect(formatET(new Date('2026-07-15T14:30:00.000Z'), 'time')).toBe('10:30 AM');
  });

  it('formats with full datetime', () => {
    const s = formatET(new Date('2026-11-15T18:00:00.000Z'), 'datetime');
    expect(s).toMatch(/Nov 15, 2026/);
  });
});

describe('parseEtLocalInput', () => {
  it('interprets datetime-local string as ET wall time and converts to UTC', () => {
    // 2026-11-15T09:00 ET (EST = UTC-5) = 14:00 UTC
    const d = parseEtLocalInput('2026-11-15T09:00');
    expect(d.toISOString()).toBe('2026-11-15T14:00:00.000Z');
  });

  it('handles DST transition correctly', () => {
    // 2026-07-15T09:00 ET (EDT = UTC-4) = 13:00 UTC
    const d = parseEtLocalInput('2026-07-15T09:00');
    expect(d.toISOString()).toBe('2026-07-15T13:00:00.000Z');
  });
});

describe('toEtIso', () => {
  it('returns ISO string with -05:00 or -04:00 offset depending on DST', () => {
    const winter = toEtIso(new Date('2026-01-15T14:30:00.000Z'));
    expect(winter).toMatch(/-05:00$/);
    const summer = toEtIso(new Date('2026-07-15T14:30:00.000Z'));
    expect(summer).toMatch(/-04:00$/);
  });
});
