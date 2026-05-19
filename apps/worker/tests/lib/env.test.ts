import { describe, expect, it } from 'vitest';
import { EnvSchema } from '../../src/lib/env.js';

describe('EnvSchema (Plan 06 additions)', () => {
  const base = {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.mbfdhub.com',
    JWT_SIGNING_KEY: 'a'.repeat(32),
    PIN_HASH: 'xxx',
    PORTAL_BID_READER: 'xxx',
  } as const;

  it('accepts AI env when fully populated', () => {
    const parsed = EnvSchema.parse({
      ...base,
      CF_AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/abc/mbfd-bid/anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      AI_BUDGET_CAP_CENTS: '2500',
      AI_FEATURE_FLAG_KEY: 'ai_advisory_enabled',
    });
    expect(parsed.CF_AI_GATEWAY_URL).toMatch(/^https:\/\//);
    expect(parsed.AI_BUDGET_CAP_CENTS).toBe(2500);
  });

  it('rejects a non-HTTPS gateway URL', () => {
    expect(() =>
      EnvSchema.parse({
        ...base,
        CF_AI_GATEWAY_URL: 'http://insecure',
        ANTHROPIC_API_KEY: 'k',
      }),
    ).toThrow();
  });

  it('defaults AI_BUDGET_CAP_CENTS to 2500 when omitted', () => {
    const parsed = EnvSchema.parse({
      ...base,
      CF_AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/abc/mbfd-bid/anthropic',
      ANTHROPIC_API_KEY: 'sk',
    });
    expect(parsed.AI_BUDGET_CAP_CENTS).toBe(2500);
  });
});
