import { describe, expect, it } from 'vitest';
import { isAdminEmployeeId } from '../../src/lib/env';

describe('isAdminEmployeeId', () => {
  it('returns false when the allow-list is empty', () => {
    expect(isAdminEmployeeId('', '14335')).toBe(false);
  });

  it('returns false when the employee id is empty', () => {
    expect(isAdminEmployeeId('14335,18156', '')).toBe(false);
  });

  it('matches a single id', () => {
    expect(isAdminEmployeeId('14335', '14335')).toBe(true);
  });

  it('matches one entry inside a comma-separated list', () => {
    expect(isAdminEmployeeId('14335,18156,20487', '18156')).toBe(true);
  });

  it('returns false for an id not in the list', () => {
    expect(isAdminEmployeeId('14335,18156', '99999')).toBe(false);
  });

  it('trims whitespace around list entries', () => {
    expect(isAdminEmployeeId(' 14335 , 18156 ', '18156')).toBe(true);
  });

  it('trims whitespace on the lookup id', () => {
    expect(isAdminEmployeeId('14335', ' 14335 ')).toBe(true);
  });

  it('does not match a prefix substring', () => {
    expect(isAdminEmployeeId('14335', '143')).toBe(false);
    expect(isAdminEmployeeId('14335', '1433')).toBe(false);
  });

  it('ignores blank entries in the list', () => {
    expect(isAdminEmployeeId(',,14335,,', '14335')).toBe(true);
  });
});
