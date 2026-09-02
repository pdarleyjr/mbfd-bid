import { describe, expect, it } from 'vitest';
import { EnvSchema } from '../../src/lib/env.js';

describe('EnvSchema', () => {
  const base = {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.mbfdhub.com',
    JWT_SIGNING_KEY: 'a'.repeat(32),
    PORTAL_BID_FEDERATION_TOKEN: 'xxx',
  } as const;

  it('parses the core worker environment', () => {
    const parsed = EnvSchema.parse(base);
    expect(parsed.ENV).toBe('staging');
    expect(parsed.PORTAL_BASE_URL).toBe('https://portal.mbfdhub.com');
  });
});
