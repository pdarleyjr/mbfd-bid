import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { verifyProductionWorkerHealth } from './assert-production-worker-health.mjs';

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

test('only a successful production health contract admits the next job', async () => {
  const result = await verifyProductionWorkerHealth({
    attempts: 1,
    fetcher: async (url, options) => {
      assert.equal(url.origin, 'https://api.bid.mbfdhub.com');
      assert.equal(url.pathname, '/api/health');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      return reply({ ok: true, env: 'production' });
    },
  });
  assert.deepEqual(result, { status: 200, environment: 'production', attempt: 1 });
});

for (const [label, body, status] of [
  ['staging', { ok: true, env: 'staging' }, 200],
  ['unhealthy', { ok: false, env: 'production' }, 200],
  ['string truth value', { ok: 'true', env: 'production' }, 200],
  ['failed HTTP status', { ok: true, env: 'production' }, 503],
]) {
  test(`${label} fails closed`, async () => {
    await assert.rejects(
      verifyProductionWorkerHealth({ attempts: 1, fetcher: async () => reply(body, status) }),
      /HEALTH_GATE_BLOCKED/,
    );
  });
}

test('a transient network error retries within the bounded gate', async () => {
  let reads = 0;
  const waits = [];
  const result = await verifyProductionWorkerHealth({
    attempts: 2,
    wait: async (ms) => {
      waits.push(ms);
    },
    fetcher: async () => {
      reads += 1;
      if (reads === 1) throw new Error('synthetic network failure');
      return reply({ ok: true, env: 'production' });
    },
  });
  assert.equal(result.attempt, 2);
  assert.deepEqual(waits, [2_000]);
});

test('persistent failure stops after the configured attempts without logging response bodies', async () => {
  let reads = 0;
  await assert.rejects(
    verifyProductionWorkerHealth({
      attempts: 3,
      wait: async () => {},
      fetcher: async () => {
        reads += 1;
        return new Response('synthetic non-json private upstream detail', { status: 502 });
      },
    }),
    /HEALTH_GATE_BLOCKED/,
  );
  assert.equal(reads, 3);
});
