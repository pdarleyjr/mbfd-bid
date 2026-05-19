import { describe, expect, it } from 'vitest';
import { parseAdvisoryFromText } from '../../src/ai/output-parser.js';
import canonical from './__fixtures__/advisory-canonical.json';

const canonStr = JSON.stringify(canonical);

describe('parseAdvisoryFromText', () => {
  it('parses plain JSON body', () => {
    const r = parseAdvisoryFromText(canonStr);
    expect(r).not.toBeNull();
    expect(r?.summary.length).toBeGreaterThan(0);
  });

  it('strips ```json … ``` fences', () => {
    const fenced = `\`\`\`json\n${canonStr}\n\`\`\``;
    expect(parseAdvisoryFromText(fenced)).not.toBeNull();
  });

  it('strips ```json with language tag and a leading paragraph', () => {
    const wrapped = `Here is the advisory you requested:\n\n\`\`\`json\n${canonStr}\n\`\`\`\n\nLet me know if you need a deeper look.`;
    expect(parseAdvisoryFromText(wrapped)).not.toBeNull();
  });

  it('returns null on garbage', () => {
    expect(parseAdvisoryFromText('completely not JSON, sorry')).toBeNull();
  });

  it('returns null on JSON that does not match schema', () => {
    expect(parseAdvisoryFromText(JSON.stringify({ summary: 'x' }))).toBeNull();
  });

  it('handles a leading BOM', () => {
    expect(parseAdvisoryFromText(`﻿${canonStr}`)).not.toBeNull();
  });
});
