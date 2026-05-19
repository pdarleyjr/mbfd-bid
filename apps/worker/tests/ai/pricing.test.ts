import { describe, expect, it } from 'vitest';
import { MODEL_PRICING, computeCostCents } from '../../src/ai/pricing.js';

describe('MODEL_PRICING', () => {
  it('has entries for both Sonnet and Opus production aliases', () => {
    expect(MODEL_PRICING['claude-sonnet-4-6']).toBeDefined();
    expect(MODEL_PRICING['claude-opus-4-7']).toBeDefined();
  });

  it('input price for Sonnet is positive cents per MTok', () => {
    const p = MODEL_PRICING['claude-sonnet-4-6'];
    expect(p).toBeDefined();
    expect(p?.inputCentsPerMTok).toBeGreaterThan(0);
  });

  it('cache-read is exactly 10% of input for both models', () => {
    for (const k of ['claude-sonnet-4-6', 'claude-opus-4-7'] as const) {
      const p = MODEL_PRICING[k];
      expect(p).toBeDefined();
      if (!p) throw new Error('missing');
      expect(p.cacheReadCentsPerMTok).toBeCloseTo(p.inputCentsPerMTok * 0.1, 4);
    }
  });
});

describe('computeCostCents', () => {
  it('returns 0 for unknown model', () => {
    expect(
      computeCostCents('claude-unknown', { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }),
    ).toBe(0);
  });

  it('computes integer cents — Sonnet 1000 input / 500 output', () => {
    const c = computeCostCents('claude-sonnet-4-6', {
      input: 1000,
      output: 500,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(Number.isInteger(c)).toBe(true);
    expect(c).toBeGreaterThanOrEqual(0);
  });

  it('cache-read tokens count 10% of input rate', () => {
    const c1 = computeCostCents('claude-sonnet-4-6', {
      input: 10_000_000,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    const c2 = computeCostCents('claude-sonnet-4-6', {
      input: 0,
      output: 0,
      cacheRead: 10_000_000,
      cacheWrite: 0,
    });
    expect(c2).toBeCloseTo(c1 / 10, 0);
  });

  it('cache-write tokens count 1.25× input rate', () => {
    const c1 = computeCostCents('claude-sonnet-4-6', {
      input: 10_000_000,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    const c2 = computeCostCents('claude-sonnet-4-6', {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 10_000_000,
    });
    expect(c2 / c1).toBeCloseTo(1.25, 1);
  });
});
