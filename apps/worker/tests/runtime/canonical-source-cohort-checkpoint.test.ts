import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { loadCanonicalBidSessionState } from '../../src/commands/canonical-command-service.js';
import type { WorkerEnv } from '../../src/types/env.js';
import {
  type CohortFixtureInput,
  prepareSourceBoundCohort,
} from '../integration/helpers/source-bound-cohort.js';

const privateEnv = env as unknown as WorkerEnv & {
  SOURCE_COHORT_FIXTURE?: string;
  SOURCE_FREEZE?: string;
};
it.skipIf(!privateEnv.SOURCE_COHORT_FIXTURE || !privateEnv.SOURCE_FREEZE)(
  'saves, previews, starts and reconstructs the sealed source cohort through actual HTTP/D1/DO',
  async () => {
    if (!privateEnv.SOURCE_COHORT_FIXTURE || !privateEnv.SOURCE_FREEZE)
      throw new Error('Private source runtime fixture required');
    const data = JSON.parse(privateEnv.SOURCE_COHORT_FIXTURE);
    const cohort = await prepareSourceBoundCohort(privateEnv, {
      ...data,
      sourceFreeze: JSON.parse(privateEnv.SOURCE_FREEZE),
    } as CohortFixtureInput);
    const response = await cohort.request(`bid-session/${cohort.sessionId}/start`, {});
    expect(response.status, await response.clone().text()).toBe(200);
    const before = await loadCanonicalBidSessionState(privateEnv.DB, cohort.sessionId);
    expect(before?.lastSeq).toBe(0);
    expect(before?.bidOrder).toHaveLength(284);
    const stub = env.BID_SESSION.get(env.BID_SESSION.idFromName(cohort.sessionId));
    let originalInstance: unknown;
    await runInDurableObject(stub, async (instance) => {
      originalInstance = instance;
      (instance as unknown as { runtimeSentinel?: string }).runtimeSentinel = 'memory-only';
    });
    await evictDurableObject(stub);
    const results = await cohort.request(`bid-session/${cohort.sessionId}/results`);
    expect(results.status, await results.clone().text()).toBe(200);
    expect(await results.json()).toMatchObject({
      awardSource: 'CANONICAL',
      awards: [],
      provenance: { valid: true },
    });
    const after = await loadCanonicalBidSessionState(privateEnv.DB, cohort.sessionId);
    expect(after).toEqual(before);
    await stub.fetch('https://local-source-do/snapshot');
    await runInDurableObject(stub, async (instance) => {
      expect(instance).not.toBe(originalInstance);
      expect((instance as unknown as { runtimeSentinel?: string }).runtimeSentinel).toBeUndefined();
    });
    const paused = await cohort.request(`bid-session/${cohort.sessionId}/commands/live`, {
      v: 1,
      type: 'live.pause',
      commandId: crypto.randomUUID(),
      expectedSeq: 0,
      reason: 'Preserve owned source-bound engineering checkpoint',
      evidenceReference: 'local:source-cohort-runtime',
    });
    expect(paused.status, await paused.clone().text()).toBe(200);
    expect(
      await privateEnv.DB.prepare('SELECT count(*) AS n FROM member_assignments').first(),
    ).toEqual({ n: 0 });
    expect(await privateEnv.DB.prepare('SELECT count(*) AS n FROM bids').first()).toEqual({ n: 0 });
    // biome-ignore lint/suspicious/noConsole: Emit the sanitized runtime acceptance receipt into the retained test log.
    console.log(
      JSON.stringify({
        kind: 'ACTUAL_HTTP_D1_DO_SOURCE_COHORT_CHECKPOINT',
        sourceDefinitionSha256: data.sourceDefinitionSha256,
        sourceEvaluationSha256: data.sourceEvaluationSha256,
        localSessionId: cohort.sessionId,
        uniqueParticipants: 222,
        stageEntries: 284,
        actualEvictionReconstruction: true,
        completed: false,
        departmentWrites: 0,
        legacyWrites: 0,
        productionWrites: 0,
      }),
    );
  },
  120000,
);
