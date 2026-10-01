import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A bounded, read-only gate between Worker deployment and Web deployment. */
export async function verifyProductionWorkerHealth({
  fetcher = fetch,
  attempts = 5,
  wait = (ms) => new Promise((done) => setTimeout(done, ms)),
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const url = new URL('https://api.bid.mbfdhub.com/api/health');
      url.searchParams.set('release_probe', `${Date.now()}-${attempt}`);
      const response = await fetcher(url, {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(8_000),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 200 && body?.ok === true && body?.env === 'production')
        return { status: 200, environment: 'production', attempt };
    } catch {
      // Network errors, non-JSON bodies and redirects do not admit the Web release.
    }
    if (attempt < attempts) await wait(2_000);
  }
  throw new Error(
    'PRODUCTION_WORKER_HEALTH_GATE_BLOCKED: the deployed API did not prove HTTP 200, ok=true and env=production. Web deployment must not proceed.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyProductionWorkerHealth();
    process.stdout.write(
      `PRODUCTION_WORKER_HEALTH_GATE_PASS: HTTP ${result.status}, ENV=${result.environment}, attempt=${result.attempt}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Production Worker health gate failed.'}\n`,
    );
    process.exitCode = 1;
  }
}
