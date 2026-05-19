import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT_VERSION, systemBlock } from '../../src/ai/prompts/system-2026.js';

describe('systemBlock', () => {
  it('returns an array of one text block with cache_control', () => {
    const b = systemBlock();
    expect(Array.isArray(b)).toBe(true);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
  });

  it('text includes all three rulebook section markers', () => {
    const b = systemBlock();
    expect(b[0]?.text).toContain('BEGIN Bid Process');
    expect(b[0]?.text).toContain('BEGIN Rules & Points');
    expect(b[0]?.text).toContain('BEGIN Position Template');
  });

  it('text states the deterministic-engine constraint verbatim', () => {
    expect(systemBlock()[0]?.text).toContain('do not recompute eligibility');
  });

  it('text declares the required JSON output shape', () => {
    expect(systemBlock()[0]?.text).toContain('"eligible_recommendations"');
    expect(systemBlock()[0]?.text).toContain('"force_recommended"');
  });

  it('SYSTEM_PROMPT_VERSION is a date-like string', () => {
    expect(SYSTEM_PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
