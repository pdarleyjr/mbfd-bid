import { describe, expect, it } from 'vitest';

import { redactRequestLog } from '../../src/lib/request-log.js';

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
});
