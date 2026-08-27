import { describe, expect, it, vi } from 'vitest';

import { app } from '../../src/index.js';
import { redactRequestLog } from '../../src/lib/request-log.js';
import type { WorkerEnv } from '../../src/types/env.js';

function env(): WorkerEnv {
  return {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.example',
    JWT_SIGNING_KEY: 'x'.repeat(64),
    PIN_HASH: '$2b$12$placeholder',
    PORTAL_BID_READER: 'tok',
    DB: {} as never,
    KV: {} as never,
    BID_SESSION: {} as never,
    AUDIT_SIGNING_PRIVKEY: '',
    AUDIT_SIGNING_PUBKEY: '',
    BROWSERLESS_TOKEN: '',
    R2_AUDIT: {} as never,
    R2_EXPORTS: {} as never,
    PORTAL_QUEUE: {} as never,
    BROWSER: {} as never,
  };
}

describe('request log redaction', () => {
  it('removes every query value from incoming and outgoing request logs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
    const incoming = redactRequestLog(`<-- GET /api/ws/session/01H?token=${jwt}`);
    const outgoing = redactRequestLog(
      `--> GET /api/admin/exports?%74oken=${jwt}&format=pdf 200 7ms`,
    );

    expect(incoming).toBe('<-- GET /api/ws/session/01H?<redacted>');
    expect(outgoing).toBe('--> GET /api/admin/exports?<redacted> 200 7ms');
    expect(incoming).not.toContain(jwt);
    expect(outgoing).not.toContain(jwt);
  });

  it('uses the redaction callback for application request logs', async () => {
    const secret = 'not-for-logs';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await app.request(`/api/health?%74oken=${secret}`, undefined, env());
      const messages = log.mock.calls.map(([message]) => String(message)).join('\n');
      expect(messages).toContain('/api/health?<redacted>');
      expect(messages).not.toContain(secret);
    } finally {
      log.mockRestore();
    }
  });
});
