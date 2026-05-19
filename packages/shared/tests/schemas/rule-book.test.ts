import { describe, expect, it } from 'vitest';
import {
  CreateRuleBookSchema,
  PublishRuleBookSchema,
  RuleBookStatusSchema,
} from '../../src/schemas/rule-book.js';

describe('RuleBookStatusSchema', () => {
  it('accepts each of draft/active/archived', () => {
    expect(RuleBookStatusSchema.parse('draft')).toBe('draft');
    expect(RuleBookStatusSchema.parse('active')).toBe('active');
    expect(RuleBookStatusSchema.parse('archived')).toBe('archived');
  });

  it('rejects other values', () => {
    expect(() => RuleBookStatusSchema.parse('published')).toThrow();
  });
});

describe('PublishRuleBookSchema', () => {
  it('requires a reason (min 4 chars)', () => {
    expect(() => PublishRuleBookSchema.parse({ reason: 'go' })).toThrow();
    expect(PublishRuleBookSchema.parse({ reason: 'Approved by chiefs.' }).reason).toMatch(
      /Approved/,
    );
  });
});

describe('CreateRuleBookSchema', () => {
  it('accepts a clone request', () => {
    const ok = CreateRuleBookSchema.parse({
      effective_year: 2026,
      clone_from: '2025.4',
      notes: 'Mid-year corrections.',
    });
    expect(ok.effective_year).toBe(2026);
  });

  it('accepts a fresh request (no clone_from)', () => {
    const ok = CreateRuleBookSchema.parse({ effective_year: 2027, notes: 'Fresh.' });
    expect(ok.clone_from).toBeUndefined();
  });

  it('rejects year < 2024', () => {
    expect(() => CreateRuleBookSchema.parse({ effective_year: 1999 })).toThrow();
  });
});
