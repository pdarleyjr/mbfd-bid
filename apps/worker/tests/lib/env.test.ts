import { describe, expect, it } from 'vitest';
import { EnvSchema } from '../../src/lib/env.js';

describe('EnvSchema (Plan 06 / Workers AI swap)', () => {
  const base = {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.mbfdhub.com',
    JWT_SIGNING_KEY: 'a'.repeat(32),
    PIN_HASH: 'xxx',
    PORTAL_BID_READER: 'xxx',
  } as const;

  it('parses without ANTHROPIC_API_KEY / CF_AI_GATEWAY_URL (Workers AI swap)', () => {
    const parsed = EnvSchema.parse({
      ...base,
      AI_BUDGET_CAP_CENTS: '2500',
      AI_FEATURE_FLAG_KEY: 'ai_advisory_enabled',
    });
    expect(parsed.AI_BUDGET_CAP_CENTS).toBe(2500);
    expect(parsed.AI_FEATURE_FLAG_KEY).toBe('ai_advisory_enabled');
    expect(parsed.CF_AI_GATEWAY_URL).toBeUndefined();
    expect(parsed.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('still accepts legacy CF_AI_GATEWAY_URL / ANTHROPIC_API_KEY (one-release compat)', () => {
    const parsed = EnvSchema.parse({
      ...base,
      CF_AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/abc/mbfd-bid/anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    expect(parsed.CF_AI_GATEWAY_URL).toMatch(/^https:\/\//);
    expect(parsed.ANTHROPIC_API_KEY).toBe('sk-ant-test');
  });

  it('defaults AI_BUDGET_CAP_CENTS to 2500 when omitted', () => {
    const parsed = EnvSchema.parse(base);
    expect(parsed.AI_BUDGET_CAP_CENTS).toBe(2500);
  });
});
