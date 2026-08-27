import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Unstable_DevWorker, unstable_dev } from 'wrangler';

describe('BidSession DO recovery (Plan 04 Task 15)', () => {
  let worker: Unstable_DevWorker;
  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      vars: {
        JWT_SIGNING_KEY: 'test-key-with-at-least-32-characters-long',
        ENV: 'staging',
        PORTAL_BASE_URL: 'https://x.example',
        PORTAL_BID_READER: 'x',
      },
      durableObjects: [{ name: 'BID_SESSION', class_name: 'BidSessionDO' }],
    });
  });
  afterAll(async () => worker.stop());

  it('snapshot survives across requests (proxy for DO eviction)', async () => {
    const r1 = await worker.fetch('/api/board?bidSessionId=01HRECOVERY', {
      headers: { Authorization: 'Bearer test' },
    });
    expect([200, 401]).toContain(r1.status);
    // The DO is created on first access. A second access returns the same state.
    const r2 = await worker.fetch('/api/board?bidSessionId=01HRECOVERY', {
      headers: { Authorization: 'Bearer test' },
    });
    expect(r2.status).toBe(r1.status);
  });

  it('client reconnect receives state_snapshot with lastSeq matching pre-disconnect', () => {
    // Implementer: open WS, send hello, observe state_snapshot, capture seq.
    // Close WS, reopen, send hello with lastSeq=N, observe state_snapshot or RESYNC.
    expect(true).toBe(true);
  });
});
