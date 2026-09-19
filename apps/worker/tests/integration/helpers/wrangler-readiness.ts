import { expect } from 'vitest';
import type { Unstable_DevWorker } from 'wrangler';
import { signJwt } from '../../../src/lib/jwt.js';

const READINESS_TIMEOUT_MS = 40_000;
const READINESS_MEMBER_ID = 900001;
const READINESS_SESSION_ID = 'SYNTHETIC_LAUNCHER_READINESS';

/**
 * unstable_dev resolves when its proxy is listening. The first real Worker
 * request and first Durable Object request can still wait for cold startup.
 * Complete those read-only probes in beforeAll's lifecycle budget, leaving
 * each route assertion under its normal timeout. No sleeps or retries mask a
 * wrong response; the owning suite's afterAll stops the Worker on failure too.
 */
export async function waitForWranglerRuntime(
  worker: Unstable_DevWorker,
  signingKey: string,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READINESS_TIMEOUT_MS);
  try {
    const health = await worker.fetch('/api/health', { signal: controller.signal });
    expect(health.status, 'Wrangler Worker health readiness').toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, env: 'staging' });

    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt(
      {
        sub: READINESS_MEMBER_ID,
        hub_user_id: READINESS_MEMBER_ID,
        member_id: READINESS_MEMBER_ID,
        emp: 'SYNTHETIC_READINESS',
        role: 'member',
        security_version: 1,
        rank: 'FF',
        first_name: 'Synthetic',
        last_name: 'Readiness',
        fresh_auth_at: now,
        authz_checked_at: now,
      },
      signingKey,
    );
    const init = {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: controller.signal,
    };
    const profile = await worker.fetch('/api/me', init);
    expect(profile.status, 'Wrangler authenticated runtime readiness').toBe(200);
    expect(await profile.json()).toMatchObject({ memberId: READINESS_MEMBER_ID });

    const state = await worker.fetch(`/api/bid/a-day-state?session=${READINESS_SESSION_ID}`, init);
    expect(state.status, 'Wrangler local Durable Object readiness').toBe(200);
    expect(await state.json()).toMatchObject({
      currentPhase: 'config',
      isMyTurn: false,
      eligibleADays: [],
      meters: { groups: [], weekdays: [] },
    });
  } finally {
    clearTimeout(timeout);
  }
}
