import { BidDispositionSchema, FrozenLiveBidPolicySchema, LiveBidActionSchema } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerEnv } from '../../src/types/env.js';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  readiness: vi.fn(),
  receipt: vi.fn(),
  summarize: vi.fn(),
}));

vi.mock('../../src/lib/bid-definition-run.js', () => ({
  prepareBidDefinitionRun: mocks.prepare,
}));
vi.mock('../../src/lib/live-bid-readiness.js', () => ({
  evaluateLiveBidReadiness: mocks.readiness,
}));
vi.mock('../../src/lib/admin-configuration-receipt.js', () => ({
  loadConfigurationReceipt: mocks.receipt,
}));
vi.mock('../../src/lib/bid-policy.js', () => ({
  loadFrozenSessionBidPolicy: vi.fn(),
  summarizeBidSessionPolicySnapshot: mocks.summarize,
}));

import {
  createBidDefinitionLive,
  previewBidDefinitionLive,
} from '../../src/lib/bid-definition-live.js';

const LIVE_CREATOR = 501;
const TRANSITION_ONLY_ACTOR = 502;
const CONTEXT_SHA256 = 'a'.repeat(64);
const SOURCE_TOKEN = 'b'.repeat(64);

function policyWithSeparatedAuthority() {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-live-creation-authority',
    stages: [
      {
        id: 'firefighter',
        label: 'Synthetic firefighter stage',
        order: 0,
        memberIds: [LIVE_CREATOR],
        opportunityPositionIds: ['synthetic-live-seat'],
        kind: 'FIREFIGHTER',
      },
    ],
    dispositions: BidDispositionSchema.options.map((disposition) => ({
      disposition,
      advances: true,
      returns: false,
      returnStageId: null,
      retainsLaterSelectionRights: false,
      terminal: false,
      requiresReason: true,
      requiresEvidence: false,
      contactPolicyReference: null,
    })),
    actionPermissions: LiveBidActionSchema.options.map((action) => ({
      action,
      actorMemberIds:
        action === 'approve_transition'
          ? [TRANSITION_ONLY_ACTOR]
          : String(action) === 'create_live_session'
            ? [LIVE_CREATOR]
            : [LIVE_CREATOR],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
  });
}

function preparedSnapshot() {
  return {
    ok: true,
    snapshot: {
      v: 3,
      configurationRevision: 1,
      settings: {
        v: 3,
        livePolicy: policyWithSeparatedAuthority(),
      },
    },
    coverage: { valid: true },
    pins: {
      bidVersionId: 'synthetic-version',
      bidVersionSha256: 'c'.repeat(64),
      contextSha256: CONTEXT_SHA256,
      snapshotSha256: 'd'.repeat(64),
    },
    sourceGuard: { token: SOURCE_TOKEN, sql: '1=1', parameters: [] },
  } as never;
}

/** The stub deliberately has no persistence surface. These are prepared-snapshot
 * authority tests, not a way to bypass the sealed version lifecycle. */
const noMutationDatabase = {} as D1Database;
const noRuntimeBindings = {} as WorkerEnv;
const selection = { versionId: 'synthetic-version', versionSha256: 'c'.repeat(64) };

describe('managed Live creation authority', () => {
  beforeEach(() => {
    mocks.prepare.mockResolvedValue(preparedSnapshot());
    mocks.receipt.mockResolvedValue(null);
    mocks.summarize.mockReturnValue([]);
    mocks.readiness.mockImplementation(
      async ({ operatorAuthorized }: { operatorAuthorized: boolean }) =>
        ({ canStartLiveBid: operatorAuthorized }) as never,
    );
  });

  afterEach(() => vi.clearAllMocks());

  it('does not treat post-Bid transition approval as Managed Live creation authority in preview or create', async () => {
    const preview = await previewBidDefinitionLive(
      noMutationDatabase,
      noRuntimeBindings,
      2027,
      selection,
      TRANSITION_ONLY_ACTOR,
    );

    expect(preview).toMatchObject({ wouldAllowCreateLive: false });
    expect(mocks.readiness).toHaveBeenCalledWith(
      expect.objectContaining({ operatorAuthorized: false }),
    );

    mocks.readiness.mockClear();
    const created = await createBidDefinitionLive(noMutationDatabase, noRuntimeBindings, {
      year: 2027,
      key: 'transition-only-must-not-create-live',
      actorSubject: String(TRANSITION_ONLY_ACTOR),
      actorId: TRANSITION_ONLY_ACTOR,
      body: {
        ...selection,
        expectedContextSha256: CONTEXT_SHA256,
        expectedSourceToken: SOURCE_TOKEN,
      },
    });

    expect(created).toEqual({
      ok: false,
      error: 'live_action_forbidden',
      action: 'create_live_session',
    });
    expect(mocks.readiness).not.toHaveBeenCalled();
  });

  it('uses only the explicit create_live_session grant for the prepared-snapshot preflight and create path', async () => {
    const preview = await previewBidDefinitionLive(
      noMutationDatabase,
      noRuntimeBindings,
      2027,
      selection,
      LIVE_CREATOR,
    );

    expect(preview).toMatchObject({ wouldAllowCreateLive: true });
    expect(mocks.readiness).toHaveBeenCalledWith(
      expect.objectContaining({ operatorAuthorized: true }),
    );

    mocks.readiness.mockImplementation(async () => ({ canStartLiveBid: false }) as never);
    const created = await createBidDefinitionLive(noMutationDatabase, noRuntimeBindings, {
      year: 2027,
      key: 'create-live-only-preflight',
      actorSubject: String(LIVE_CREATOR),
      actorId: LIVE_CREATOR,
      body: {
        ...selection,
        expectedContextSha256: CONTEXT_SHA256,
        expectedSourceToken: SOURCE_TOKEN,
      },
    });

    expect(created).toMatchObject({ ok: false, error: 'readiness_blocked' });
    expect(mocks.readiness).toHaveBeenLastCalledWith(
      expect.objectContaining({ operatorAuthorized: true }),
    );
  });
});
