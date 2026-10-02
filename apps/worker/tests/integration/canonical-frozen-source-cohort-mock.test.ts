import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { LiveBidCommandSchema } from '@mbfd/shared';
import { expect, it, vi } from 'vitest';
import {
  commitLiveBidCommand,
  loadCanonicalBidSessionState,
} from '../../src/commands/canonical-command-service.js';
import { getDb } from '../../src/db/index.js';
import { loadFrozenSessionBidPolicy } from '../../src/lib/bid-policy.js';
import {
  type CohortFixtureInput,
  prepareSourceBoundCohort,
} from './helpers/source-bound-cohort.js';
import { setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const fixturePath = process.env.MBFD_FROZEN_COHORT_FIXTURE;
it.skipIf(!fixturePath)(
  'creates and starts a separate source-bound sealed V11 cohort Mock',
  async () => {
    if (!fixturePath || !process.env.MBFD_FROZEN_COHORT_SOURCE_PACKET)
      throw new Error('Private source packet and pseudonym fixture required');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T15:00:00Z'));
    const h = await setupTestD1();
    try {
      h.sqlite.pragma('foreign_keys = ON');
      const raw = readFileSync(fixturePath);
      const fixtureSha256 = createHash('sha256').update(raw).digest('hex');
      expect(fixtureSha256).toBe(process.env.MBFD_FROZEN_COHORT_FIXTURE_SHA256);
      const data = JSON.parse(new TextDecoder().decode(raw));
      const source = JSON.parse(readFileSync(process.env.MBFD_FROZEN_COHORT_SOURCE_PACKET, 'utf8'));
      const lease = h.env.BID_SESSION.get(h.env.BID_SESSION.idFromName('local-source-fixture'));
      h.env.BID_SESSION = {
        idFromName: (name: string) => ({ toString: () => name }),
        get: () => ({
          fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const request = new Request(input, init);
            if (new URL(request.url).pathname.startsWith('/admin/normal-mutation-lease/'))
              return lease.fetch(request.url);
            const command = LiveBidCommandSchema.parse(await request.json());
            const state = await loadCanonicalBidSessionState(h.env.DB, command.bidSessionId);
            const policy = await loadFrozenSessionBidPolicy(getDb(h.env.DB), command.bidSessionId);
            if (!state || !policy.ok || policy.snapshot.v !== 3 || policy.snapshot.settings.v !== 3)
              throw new Error('Local source canonical pin required');
            const result = await commitLiveBidCommand({
              db: h.env.DB,
              state,
              command,
              policy: policy.snapshot.settings.livePolicy,
            });
            return Response.json(result.result, {
              status: result.result.kind === 'accepted' ? 200 : 409,
            });
          },
        }),
      } as unknown as typeof h.env.BID_SESSION;
      const cohort = await prepareSourceBoundCohort(h.env, {
        ...data,
        sourceFreeze: source.freeze,
      } as CohortFixtureInput);
      const participantIds = new Set(
        cohort.snapshot.settings.v === 3
          ? cohort.snapshot.settings.livePolicy.stages.flatMap((stage) => stage.memberIds)
          : [],
      );
      expect(participantIds.size).toBe(222);
      expect(cohort.sessionId).not.toBe('01M3T9F9BS04W8CNRNN8WG5Z5T');
      expect(await loadCanonicalBidSessionState(h.env.DB, cohort.sessionId)).toBeNull();
      const started = await cohort.request(`bid-session/${cohort.sessionId}/start`, {});
      expect(started.status, await started.clone().text()).toBe(200);
      const state = await loadCanonicalBidSessionState(h.env.DB, cohort.sessionId);
      expect(state?.lastSeq).toBe(0);
      expect(state?.bidOrder).toHaveLength(284);
      expect(state?.currentBidderId).not.toBeNull();
      const projected = await cohort.request(`bid-session/${cohort.sessionId}/results`);
      expect(projected.status).toBe(200);
      expect(await projected.json()).toMatchObject({
        awardSource: 'CANONICAL',
        awards: [],
        provenance: { valid: true },
      });
      const pause = await cohort.request(`bid-session/${cohort.sessionId}/commands/live`, {
        v: 1,
        type: 'live.pause',
        commandId: randomUUID(),
        expectedSeq: 0,
        reason: 'Preserve isolated source-bound V11 engineering epoch',
        evidenceReference: 'local-source-fixture:checkpoint',
      });
      expect(pause.status, await pause.clone().text()).toBe(200);
      expect(h.sqlite.prepare('SELECT count(*) AS n FROM member_assignments').get()).toEqual({
        n: 0,
      });
      expect(h.sqlite.prepare('SELECT count(*) AS n FROM bids').get()).toEqual({ n: 0 });
      if (process.env.MBFD_FROZEN_COHORT_REPORT)
        writeFileSync(
          process.env.MBFD_FROZEN_COHORT_REPORT,
          JSON.stringify(
            {
              fixtureSha256,
              sourceDefinitionSha256: data.sourceDefinitionSha256,
              sourceEvaluationSha256: data.sourceEvaluationSha256,
              localVersion: cohort.saved,
              localSessionId: cohort.sessionId,
              uniqueStageParticipants: participantIds.size,
              stageEntries: state?.bidOrder.length,
              sealedQualificationsPreserved: true,
              httpSavePreviewCreateStart: true,
              transport: 'loopback DO; canonical service',
              resultsCanonicalPinVerified: true,
              completed: false,
              departmentWrites: 0,
              legacyBidWrites: 0,
              sourceOrPersonalMockMutations: 0,
            },
            null,
            2,
          ),
        );
    } finally {
      vi.useRealTimers();
      await teardownTestD1(h);
    }
  },
  120000,
);
