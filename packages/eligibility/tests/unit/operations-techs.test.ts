import { describe, expect, it } from 'vitest';
import {
  OP_TECH_PAIRS,
  holdsAllOps,
  opCredNames,
  opsForTech,
  techCredNames,
} from '../../src/operations-techs.js';

describe('OP_TECH_PAIRS', () => {
  it('contains exactly 6 pairs', () => {
    expect(OP_TECH_PAIRS).toHaveLength(6);
  });

  it('each pair has non-empty ops and tech strings', () => {
    for (const pair of OP_TECH_PAIRS) {
      expect(typeof pair.ops).toBe('string');
      expect(typeof pair.tech).toBe('string');
      expect(pair.ops.length).toBeGreaterThan(0);
      expect(pair.tech.length).toBeGreaterThan(0);
    }
  });

  it('opCredNames returns 6 unique ops credential names', () => {
    const names = opCredNames();
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
  });

  it('techCredNames returns 6 unique tech credential names', () => {
    const names = techCredNames();
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
  });

  it('Hazardous Materials pair is present with exact names from 2026 rulebook', () => {
    const hazmat = OP_TECH_PAIRS.find((p) => p.ops === 'Hazardous Materials Operations');
    expect(hazmat).toBeDefined();
    expect(hazmat?.tech).toBe('State Certified Hazardous Materials Technician');
  });

  it('Rope Rescue pair is present', () => {
    const rope = OP_TECH_PAIRS.find((p) => p.ops === 'Rope Rescue Operations');
    expect(rope).toBeDefined();
    expect(rope?.tech).toBe('Rope Rescue Technician');
  });
});

describe('opsForTech', () => {
  it('returns paired ops name for a known tech credential', () => {
    expect(opsForTech('Rope Rescue Technician')).toBe('Rope Rescue Operations');
  });

  it('returns undefined for unknown tech credential', () => {
    expect(opsForTech('Some Unknown Cert')).toBeUndefined();
  });
});

describe('holdsAllOps', () => {
  it('returns true when member holds all 6 ops credentials', () => {
    const all = new Set(opCredNames());
    expect(holdsAllOps(all)).toBe(true);
  });

  it('returns false when one ops credential is missing', () => {
    const all = new Set(opCredNames());
    all.delete('Trench Rescue Operations');
    expect(holdsAllOps(all)).toBe(false);
  });

  it('returns false for empty set', () => {
    expect(holdsAllOps(new Set())).toBe(false);
  });
});
