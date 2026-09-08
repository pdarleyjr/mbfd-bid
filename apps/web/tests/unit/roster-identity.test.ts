import { shiftTone, unitTone } from '@/components/admin/RosterIdentity';
import { describe, expect, it } from 'vitest';

describe('presentation-only roster identity', () => {
  it.each([
    ['Engine 1', 'engine'],
    ['E1', 'engine'],
    ['Ladder 1', 'ladder'],
    ['L1', 'ladder'],
    ['Rescue 11', 'rescue'],
    ['R11', 'rescue'],
    ['Rescue Float Pool', 'float'],
    ['Combat Float', 'float'],
    ['Marine 4', 'marine'],
    ['Division Chief 300', 'command'],
    ['Engineering Review', 'neutral'],
    ['New Labor/Management Unit', 'neutral'],
    [null, 'neutral'],
  ])('keeps %s in the expected visual family', (label, family) => {
    expect(unitTone(label)).toBe(family);
  });
  it('keeps unmapped shifts neutral rather than implying A/B/C/D membership', () => {
    expect(shiftTone(null)).toBe('neutral');
    expect(shiftTone('unknown')).toBe('neutral');
    expect(shiftTone('D')).toBe('D');
  });
});
