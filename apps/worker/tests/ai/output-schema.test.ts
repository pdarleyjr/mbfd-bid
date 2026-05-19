import { describe, expect, it } from 'vitest';
import { AdvisorySchema } from '../../src/ai/output-schema.js';
import canonical from './__fixtures__/advisory-canonical.json';
import malformed from './__fixtures__/advisory-malformed.json';

describe('AdvisorySchema', () => {
  it('accepts the canonical fixture', () => {
    const parsed = AdvisorySchema.parse(canonical);
    expect(parsed.summary.length).toBeGreaterThan(0);
    expect(parsed.eligible_recommendations).toHaveLength(2);
    expect(parsed.force_recommended).toBe(false);
  });

  it('rejects malformed (summary=number, force_recommended=string)', () => {
    const r = AdvisorySchema.safeParse(malformed);
    expect(r.success).toBe(false);
  });

  it('forecast.warnings is optional but defaults to []', () => {
    const r = AdvisorySchema.parse({ ...canonical, forecast: { warnings: [] } });
    expect(r.forecast.warnings).toEqual([]);
  });

  it('force_reasoning is optional but required when force_recommended=true', () => {
    const ok = AdvisorySchema.parse({
      ...canonical,
      force_recommended: true,
      force_reasoning: 'last credentialed bidder',
    });
    expect(ok.force_recommended).toBe(true);
    const bad = AdvisorySchema.safeParse({ ...canonical, force_recommended: true });
    expect(bad.success).toBe(false);
  });

  it('warning level enum: info | warn | critical only', () => {
    const bad = AdvisorySchema.safeParse({
      ...canonical,
      forecast: { warnings: [{ level: 'urgent', text: 'x', affected_positions: [] }] },
    });
    expect(bad.success).toBe(false);
  });

  it('aDayInvariantSnapshot is optional (Plan 07 A-Day phase 2 reservation)', () => {
    const withSnap = AdvisorySchema.parse({
      ...canonical,
      aDayInvariantSnapshot: { note: 'reserved for Plan 07' },
    });
    expect(withSnap.aDayInvariantSnapshot).toBeDefined();
  });
});
