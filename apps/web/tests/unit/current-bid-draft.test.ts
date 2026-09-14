import {
  type BidDefinitionContent,
  BidDefinitionContentSchema,
  BidDispositionSchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { describe, expect, it, vi } from 'vitest';
import { CurrentBidSchema } from '../../app/admin/current-bid/bid-client';
import {
  type BidDraft,
  BidDraftContentSchema,
  BidDraftSchema,
  type PendingBidWrite,
  PendingBidWriteSchema,
  bidDraftKey,
  preserveBidDraft,
  readBidDraft,
} from '../../app/admin/current-bid/bid-draft';

const YEAR = 2027;
const ACTOR = 'synthetic-admin:10001';
const KEY = '9e9c00f0-bd24-4d68-a18d-0f61d4b30640';

function present<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Missing synthetic fixture material');
  return value;
}

function content(): BidDefinitionContent {
  const rule = (positionId: string) => ({
    positionId,
    requiredCriteriaJson: '{ "rank": ["FF"], "credentials": [], "custom": [] }',
    pointsPreferenceJson: '{"max":0,"items":[]}',
    tieBreakChainJson: '["rsc_seniority","rank_seniority"]',
    notes: null,
  });
  const raw = {
    v: 1,
    bidYear: YEAR,
    settings: {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
    },
    notes: { bid: '  Synthetic draft notes\nsecond line  ', positions: null },
    policy: {
      policyText: '  Synthetic source language\nkept exactly  ',
      executionPolicy: {
        v: 1,
        policyRevision: 'synthetic-policy-1',
        stages: [
          {
            id: 'synthetic-stage',
            label: 'Synthetic stage',
            order: 0,
            memberIds: [10001],
            opportunityPositionIds: ['synthetic-seat-b', 'synthetic-seat-a'],
            kind: 'FIREFIGHTER',
          },
        ],
        dispositions: BidDispositionSchema.options.map((disposition) => ({
          disposition,
          advances: true,
          returns: false,
          returnStageId: null,
          retainsLaterSelectionRights: false,
          terminal: true,
          requiresReason: true,
          requiresEvidence: false,
          contactPolicyReference: null,
        })),
        actionPermissions: LiveBidActionSchema.options.map((action) => ({
          action,
          actorMemberIds: [10001],
        })),
        specialtyCatalogReference: null,
        aDayPolicyReference: null,
        transitionPolicyReference: null,
        publicationPolicyReference: null,
        annualOperations: {
          v: 1,
          stageOrder: ['synthetic-stage'],
          requiredTopologyPositionIds: ['synthetic-seat-b', 'synthetic-seat-a'],
          contact: { minimumAttempts: 2, timingMode: 'TARGET', durationSeconds: 120 },
          aDay: {
            combatGroups: ['G1', 'G2', 'G3', 'G4'],
            min: 1,
            max: 3,
            captainDcMax: 1,
            specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
          },
        },
      },
    },
    planning: { effectiveOn: '2027-01-01', sourceSessionId: null, sourcePolicyText: null },
    authoring: {
      profiles: [
        {
          id: 'synthetic-profile-b',
          name: 'Synthetic optional profile',
          sourceRef: 'Synthetic source B',
          scope: { kind: 'family', name: 'Synthetic family', positionIds: ['synthetic-seat-b'] },
          requirements: { credentials: [], custom: [] },
        },
        {
          id: 'synthetic-profile-a',
          name: 'Synthetic scoring profile',
          sourceRef: 'Synthetic source A',
          scope: { kind: 'position', positionId: 'synthetic-seat-a' },
          requirements: {
            ranks: ['FF'],
            credentials: ['Synthetic credential Z', 'Synthetic credential A'],
            anyOfCredentials: [['Synthetic alternative B', 'Synthetic alternative A']],
            service: [{ serviceCode: 'SYNTHETIC_SERVICE', minimumMonths: 12 }],
            postAward: [],
            custom: [],
          },
          scoring: {
            v: 1,
            total: [
              {
                id: 'synthetic-group',
                cap: null,
                items: [
                  {
                    credential: 'Synthetic credential Z',
                    alternatives: [],
                    requiresAll: [],
                    points: 5,
                  },
                  {
                    credential: 'Synthetic credential A',
                    alternatives: [],
                    requiresAll: [],
                    points: 3,
                    completionCredit: {
                      sourceRef: 'Synthetic completion source',
                      effectiveFrom: '2027-01-01',
                      effectiveThrough: '2027-12-31',
                    },
                  },
                ],
              },
            ],
            so: [],
            mo: [],
          },
          tieBreakChain: ['rank_seniority', 'rsc_seniority'],
        },
      ],
      compiled: [
        {
          rule: rule('synthetic-seat-b'),
          provenance: {
            requirements: ['synthetic-profile-b', 'synthetic-profile-a'],
            scoring: [],
            priorities: ['synthetic-profile-a'],
            matched: ['synthetic-profile-b', 'synthetic-profile-a'],
          },
        },
      ],
      reconciliation: 'RULES_CHANGED_AFTER_COMPILATION',
    },
    positions: ['synthetic-seat-b', 'synthetic-seat-a'].map((id) => ({
      id,
      shift: 'A',
      station: '7',
      division: 'Combat',
      unit: 'Synthetic Engine',
      rankRequired: 'FF',
      positionName: 'Synthetic firefighter',
      isFloating: false,
      isVacantByDesign: false,
      isExcludedFromCount: false,
    })),
    rules: [rule('synthetic-seat-b'), rule('synthetic-seat-a')],
    participation: [
      {
        positionId: 'synthetic-seat-b',
        bidParticipation: 'BIDDABLE',
        authoritativeSourceRef: 'Synthetic reviewed source',
      },
    ],
    staffingBindings: [
      {
        positionId: 'synthetic-seat-b',
        staffingPositionId: 'synthetic-staffing-b',
        authoritativeSourceRef: 'Synthetic staffing source',
        reviewStatus: 'draft',
      },
    ],
    sourceDecisions: [
      {
        issueId: 'synthetic-issue',
        title: 'Synthetic source question',
        question: 'Synthetic wording?',
        area: 'rules',
        status: 'OPEN',
        decision: '',
        sourceRef: 'Synthetic source',
        effectiveOn: '2027-01-01',
      },
    ],
  };
  const parsed = BidDefinitionContentSchema.parse(raw);
  expect(parsed).toStrictEqual(raw);
  return parsed;
}

function draft(): BidDraft {
  const base = CurrentBidSchema.parse({
    bidYear: YEAR,
    state: 'LEGACY_UNADOPTED',
    version: null,
    expected: { kind: 'legacy', sourceToken: 'a'.repeat(64) },
    content: content(),
    coverage: {
      valid: true,
      ruleCount: 2,
      missingBiddablePositionIds: [],
      invalidPositionIds: [],
      duplicatePositionIds: [],
      nonBiddablePositionIds: [],
      unexpectedPositionIds: [],
    },
    stats: {
      opportunityCount: 2,
      ruleCount: 2,
      biddableCount: 2,
      administrativelyAssignedCount: 0,
      reservedCount: 0,
      excludedCount: 0,
      missingRuleCount: 0,
    },
  });
  return BidDraftSchema.parse({
    v: 1,
    actorScope: ACTOR,
    year: YEAR,
    base,
    content: structuredClone(base.content),
    reason: '  Synthetic reason\nkept exactly  ',
    pending: null,
  });
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  } satisfies Storage;
}

describe('Current Bid browser draft content', () => {
  it('preserves nulls, omitted optional fields, rule text, and ordered policy material', () => {
    const original = content();
    const parsed = BidDraftContentSchema.parse(original);
    expect(parsed).toStrictEqual(original);
    const storage = memoryStorage();
    const value = draft();
    preserveBidDraft(storage, value);
    expect(readBidDraft(storage, ACTOR, YEAR)).toStrictEqual(value);
    const profiles = present(parsed.authoring).profiles;
    expect(present(profiles[0])).not.toHaveProperty('scoring');
    expect(present(profiles[0]).requirements).not.toHaveProperty('ranks');
    expect(parsed.settings).not.toHaveProperty('personnelEvaluationOn');
    expect(present(parsed.policy).executionPolicy.annualOperations?.contact).not.toHaveProperty(
      'evidenceRequired',
    );
    expect(parsed.positions.map((position) => position.id)).toEqual([
      'synthetic-seat-b',
      'synthetic-seat-a',
    ]);
    expect(present(profiles[1]).tieBreakChain).toEqual(['rank_seniority', 'rsc_seniority']);
  });

  it('preserves explicitly unconfigured policy sections without inventing authoring material', () => {
    const original = {
      ...content(),
      settings: null,
      policy: null,
      planning: null,
      authoring: null,
      participation: [],
    };
    expect(BidDefinitionContentSchema.parse(original)).toStrictEqual(original);
    expect(BidDraftContentSchema.parse(original)).toStrictEqual(original);
  });

  it('retains incomplete text and invalid ranges without treating the draft as API-valid', () => {
    const value = draft();
    const position = present(value.content.positions[0]);
    position.id = '';
    position.station = '  ';
    position.positionName = '  In-progress label  ';
    present(value.content.rules[0]).requiredCriteriaJson = '{"rank": [';
    const settings = present(value.content.settings);
    settings.expectedDurationDays = -0.5;
    settings.turnTimerSeconds = 10000;
    if (settings.v !== 2) throw new Error('Synthetic fixture must retain V2 settings');
    settings.credentialEvaluationOn = '2027-';
    const operations = present(present(value.content.policy).executionPolicy.annualOperations);
    operations.aDay.min = 99;
    operations.aDay.max = 1;
    const profile = present(present(value.content.authoring).profiles[1]);
    profile.name = '';
    profile.requirements.ranks = [];
    profile.tieBreakChain = ['points', 'points'];
    const scoring = present(profile.scoring);
    const exception = present(present(present(scoring.total[0]).items[1]).completionCredit);
    exception.effectiveFrom = '2027-12-31';
    exception.effectiveThrough = '2027-01-01';
    expect(BidDefinitionContentSchema.safeParse(value.content).success).toBe(false);
    expect(BidDraftContentSchema.parse(value.content)).toStrictEqual(value.content);
    const storage = memoryStorage();
    preserveBidDraft(storage, value);
    expect(readBidDraft(storage, ACTOR, YEAR)).toStrictEqual(value);
  });

  it.each([
    ['unknown root field', (value: BidDefinitionContent) => ({ ...value, execute: true })],
    [
      'unknown nested field',
      (value: BidDefinitionContent) => ({ ...value, notes: { ...value.notes, token: 'unknown' } }),
    ],
    [
      'unknown discriminated union field',
      (value: BidDefinitionContent) => ({
        ...value,
        settings: { ...present(value.settings), livePolicy: {} },
      }),
    ],
    ['unknown schema version', (value: BidDefinitionContent) => ({ ...value, v: 2 })],
    [
      'unknown enum value',
      (value: BidDefinitionContent) => ({
        ...value,
        positions: [{ ...present(value.positions[0]), shift: 'UNKNOWN' }],
      }),
    ],
    [
      'numeric text',
      (value: BidDefinitionContent) => ({
        ...value,
        settings: { ...present(value.settings), turnTimerSeconds: '180' },
      }),
    ],
    ['missing required array', (value: BidDefinitionContent) => ({ ...value, rules: undefined })],
  ])('rejects %s without silently stripping unsupported material', (_name, change) => {
    expect(BidDraftContentSchema.safeParse(change(content())).success).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite draft numbers: %s',
    (number) => {
      const value = content();
      present(value.settings).turnTimerSeconds = number;
      expect(BidDraftContentSchema.safeParse(value).success).toBe(false);
    },
  );

  it('keeps the stored server base strict even while the editable content is incomplete', () => {
    const value = draft();
    present(value.base.content.settings).turnTimerSeconds = -1;
    expect(BidDraftSchema.safeParse(value).success).toBe(false);
    const storage = memoryStorage();
    expect(() => preserveBidDraft(storage, value)).toThrow();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('Current Bid storage isolation and failures', () => {
  it('isolates keys by the complete encoded actor scope and year', () => {
    const scope = 'synthetic:admin/a?b#c%20';
    expect(bidDraftKey(scope, YEAR)).toBe(
      'mbfd-current-bid:v1:synthetic%3Aadmin%2Fa%3Fb%23c%2520:2027',
    );
    expect(bidDraftKey(scope, YEAR)).not.toBe(bidDraftKey(encodeURIComponent(scope), YEAR));
    expect(bidDraftKey(scope, YEAR)).not.toBe(bidDraftKey(scope, YEAR + 1));
    const storage = memoryStorage();
    preserveBidDraft(storage, draft());
    expect(readBidDraft(storage, 'synthetic-admin:10002', YEAR)).toBeNull();
    expect(readBidDraft(storage, ACTOR, YEAR + 1)).toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('returns null only for an absent stored draft', () => {
    const storage = memoryStorage();
    expect(readBidDraft(storage, ACTOR, YEAR)).toBeNull();
    storage.setItem(bidDraftKey(ACTOR, YEAR), '');
    expect(() => readBidDraft(storage, ACTOR, YEAR)).toThrow();
  });

  it.each([
    ['another administrator', 'synthetic-admin:10002', YEAR],
    ['another year', ACTOR, YEAR + 1],
  ])('rejects valid content stored under the key of %s', (_name, actorScope, year) => {
    const storage = memoryStorage();
    storage.setItem(bidDraftKey(actorScope, year), JSON.stringify(draft()));
    expect(() => readBidDraft(storage, actorScope, year)).toThrow(
      'The saved draft belongs to another administrator or Bid.',
    );
  });

  it.each(['top-level', 'base', 'edited content', 'pending content'])(
    'rejects a mismatched %s year',
    (where) => {
      const value = draft();
      if (where === 'top-level') value.year = YEAR + 1;
      if (where === 'base') {
        value.base.bidYear = YEAR + 1;
        value.base.content.bidYear = YEAR + 1;
      }
      if (where === 'edited content') value.content.bidYear = YEAR + 1;
      if (where === 'pending content') {
        value.pending = {
          path: 'versions',
          key: KEY,
          body: {
            expected: value.base.expected,
            content: { ...value.content, bidYear: YEAR + 1 },
            reason: value.reason,
          },
        };
      }
      expect(BidDraftSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each(['{', 'null', '{"v":2}', '{"v":1,"base":{}}'])(
    'surfaces malformed or incompatible stored material: %s',
    (serialized) => {
      const storage = memoryStorage();
      storage.setItem(bidDraftKey(ACTOR, YEAR), serialized);
      expect(() => readBidDraft(storage, ACTOR, YEAR)).toThrow();
      expect(storage.getItem(bidDraftKey(ACTOR, YEAR))).toBe(serialized);
      expect(storage.removeItem).not.toHaveBeenCalled();
    },
  );

  it('propagates a failed write without reading back or clearing an existing draft', () => {
    const storage = memoryStorage();
    const value = draft();
    preserveBidDraft(storage, value);
    storage.getItem.mockClear();
    const failure = new Error('Synthetic storage quota failure');
    storage.setItem.mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => preserveBidDraft(storage, { ...value, reason: 'New reason' })).toThrow(failure);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(readBidDraft(storage, ACTOR, YEAR)).toStrictEqual(value);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([null, 'truncated', 'different bytes'])(
    'fails when storage readback does not match the complete write: %s',
    (readback) => {
      const storage = memoryStorage();
      storage.getItem.mockReturnValueOnce(readback);
      expect(() => preserveBidDraft(storage, draft())).toThrow(
        'The browser did not preserve the complete Bid draft.',
      );
      expect(storage.setItem).toHaveBeenCalledOnce();
      expect(storage.removeItem).not.toHaveBeenCalled();
    },
  );

  it('propagates unavailable storage on both read and write verification', () => {
    const storage = memoryStorage();
    const failure = new Error('Synthetic blocked storage');
    storage.getItem.mockImplementation(() => {
      throw failure;
    });
    expect(() => readBidDraft(storage, ACTOR, YEAR)).toThrow(failure);
    expect(() => preserveBidDraft(storage, draft())).toThrow(failure);
  });
});

describe('Current Bid pending write recovery', () => {
  function pendingMock(): PendingBidWrite {
    return {
      path: 'mock-sessions',
      key: KEY,
      body: {
        versionId: 'synthetic-version-7',
        versionSha256: 'b'.repeat(64),
        expectedContextSha256: 'c'.repeat(64),
        expectedSourceToken: 'd'.repeat(64),
      },
    };
  }

  it('recovers the exact Mock creation key and four pins independently of unfinished local content', () => {
    const value = draft();
    const pending = pendingMock();
    const bytes = JSON.stringify(pending);
    value.pending = pending;
    value.content.notes.bid = 'Newer incomplete local note\n';
    present(value.content.settings).turnTimerSeconds = -1;
    value.content.positions.reverse();
    const storage = memoryStorage();
    preserveBidDraft(storage, value);
    const recovered = present(readBidDraft(storage, ACTOR, YEAR));
    expect(recovered).toStrictEqual(value);
    expect(JSON.stringify(recovered.pending)).toBe(bytes);
    expect(recovered.pending?.key).toBe(KEY);
    expect(recovered.content.positions.map((position) => position.id)).toEqual(
      value.content.positions.map((position) => position.id),
    );
    expect(recovered.pending?.body).not.toHaveProperty('content');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([
    ['missing version ID', { versionId: undefined }],
    ['missing version hash', { versionSha256: undefined }],
    ['missing context hash', { expectedContextSha256: undefined }],
    ['missing source token', { expectedSourceToken: undefined }],
    ['empty version ID', { versionId: '' }],
    ['null context pin', { expectedContextSha256: null }],
    ['short source token', { expectedSourceToken: 'd'.repeat(63) }],
    ['uppercase version digest', { versionSha256: 'B'.repeat(64) }],
    ['non-hex context digest', { expectedContextSha256: 'z'.repeat(64) }],
    ['unknown Live field', { isMock: false }],
  ])('refuses to recover a Mock creation request with %s', (_label, overrides) => {
    const pending = pendingMock();
    const invalid = { ...pending, body: { ...pending.body, ...overrides } };
    expect(PendingBidWriteSchema.safeParse(invalid).success).toBe(false);
    const storage = memoryStorage();
    const raw = JSON.stringify({ ...draft(), pending: invalid });
    storage.setItem(bidDraftKey(ACTOR, YEAR), raw);
    expect(() => readBidDraft(storage, ACTOR, YEAR)).toThrow();
    expect(storage.getItem(bidDraftKey(ACTOR, YEAR))).toBe(raw);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('refuses a Mock request without its original valid idempotency key', () => {
    for (const key of [undefined, null, '', 'replacement-not-a-uuid']) {
      expect(PendingBidWriteSchema.safeParse({ ...pendingMock(), key }).success).toBe(false);
    }
  });

  it.each(['versions', 'restore'] as const)(
    'retains the exact %s request and key while newer local edits remain separate',
    (path) => {
      const value = draft();
      const expected = {
        kind: 'version' as const,
        versionId: 'synthetic-version-7',
        revision: 7,
        sha256: 'b'.repeat(64),
      };
      const reason = '  Exact original request reason\nsecond line  ';
      const pending: PendingBidWrite =
        path === 'versions'
          ? { path, key: KEY, body: { expected, content: structuredClone(value.content), reason } }
          : { path, key: KEY, body: { expected, versionId: 'synthetic-history-3', reason } };
      expect(PendingBidWriteSchema.parse(pending)).toStrictEqual(pending);
      const requestBytes = JSON.stringify(pending);
      value.pending = pending;
      value.content.notes.bid = 'Newer local edit after the uncertain request';
      value.reason = 'Newer local reason';
      const storage = memoryStorage();
      preserveBidDraft(storage, value);
      const restored = present(readBidDraft(storage, ACTOR, YEAR));
      expect(restored).toStrictEqual(value);
      expect(JSON.stringify(restored.pending)).toBe(requestBytes);
      expect(restored.pending?.key).toBe(KEY);
      expect(restored.reason).toBe('Newer local reason');
      if (restored.pending?.path === 'versions') {
        expect(restored.pending.body.content.notes.bid).not.toBe(restored.content.notes.bid);
      }
    },
  );

  it.each([
    ['unsupported path', { path: 'publish' }],
    ['missing key', { key: undefined }],
    ['invalid key', { key: 'synthetic-not-a-uuid' }],
    ['unknown envelope field', { authorization: 'unknown' }],
    ['missing reason', { body: { reason: undefined } }],
    ['unknown request field', { body: { sql: 'unknown' } }],
    ['invalid expected token', { body: { expected: { kind: 'legacy', sourceToken: 'short' } } }],
  ])('rejects a pending write with %s', (_name, override) => {
    const value = draft();
    const body = {
      expected: value.base.expected,
      versionId: 'synthetic-history-3',
      reason: value.reason,
    };
    const candidate = {
      path: 'restore',
      key: KEY,
      ...override,
      body: { ...body, ...('body' in override ? override.body : {}) },
    };
    expect(PendingBidWriteSchema.safeParse(candidate).success).toBe(false);
  });
});
