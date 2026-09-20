import { deepStrictEqual } from 'node:assert';
import {
  type AnnualRuleProfile,
  type BidDefinitionContent,
  BidProfileReviewResponseSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type JsonValue, canonicalize } from '../../src/audit/canonical-json.js';
import { app } from '../../src/index.js';
import { bidContentHash } from '../../src/lib/bid-definition-content.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import type { SaveBidDefinitionInput } from '../../src/lib/bid-definition-store.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const SEAT = 'synthetic-profile-seat';
const RESERVED = 'synthetic-profile-reserved';
type Expected = SaveBidDefinitionInput['expected'];
type Current = {
  content: BidDefinitionContent;
  expected: Expected;
  version: { id: string; versionNumber: number } | null;
};
const scoring = (points: number): AnnualRuleProfile['scoring'] => ({
  v: 1,
  total: [
    {
      id: 'synthetic-score',
      cap: null,
      items: [{ credential: 'Synthetic credit', alternatives: [], requiresAll: [], points }],
    },
  ],
  so: [],
  mo: [],
});
function profile(id = 'synthetic-shared', points = 3): AnnualRuleProfile {
  return {
    id,
    name: 'Synthetic shared requirements',
    sourceRef: 'synthetic://reviewed-source',
    scope: { kind: 'department' },
    requirements: { credentials: [], custom: ['non_probationary'] },
    scoring: scoring(points),
    tieBreakChain: ['points', 'rsc_seniority'],
  };
}

describe('Current Bid optional profile preview and canonical Save compilation', () => {
  let h: TestD1;
  let auth: string;
  let legacy: Current;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
        VALUES (10001,'synthetic-profile-10001','Synthetic','Editor','FF','FF',1,1,1);
      INSERT INTO position_templates(version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic topology');
      INSERT INTO rule_books(version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',2,'Synthetic source');
      INSERT INTO bid_years(year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',3,'{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-01","personnelEvaluationOn":"2027-01-01"}');
      INSERT INTO positions(id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('${SEAT}','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic seat'),
        ('${RESERVED}','2027.1','D','7','Administration','Synthetic Office','FF','Synthetic reserved');
      INSERT INTO position_rules(rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','${SEAT}','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}','{"max":0,"items":[]}','["rsc_seniority"]');
      INSERT INTO rule_book_position_participation(rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
        VALUES ('2027.1','${RESERVED}','2027.1','RESERVED_NON_BIDDABLE','Synthetic reserved source',1);
    `);
    const source = await captureBidDefinitionSource(h.env.DB, 2027);
    if (!source.ok) throw new Error(JSON.stringify(source));
    legacy = {
      content: source.content,
      expected: { kind: 'legacy', sourceToken: source.sourceToken },
      version: null,
    };
    auth = await signJwt(
      {
        sub: 10001,
        emp: 'synthetic-profile-10001',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Editor',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  function request(path: string, body?: unknown, key?: string) {
    return app.fetch(
      new Request(`http://x/api/admin/bid/2027/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${auth}`,
          'Content-Type': 'application/json',
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      h.env,
    );
  }
  function pending(base = legacy.content, profiles = [profile()]): BidDefinitionContent {
    return {
      ...structuredClone(base),
      authoring: { profiles, compiled: [], reconciliation: 'PROFILE_EDITS_PENDING_REVIEW' },
    };
  }
  function save(
    content: BidDefinitionContent,
    expected = legacy.expected,
    key = 'synthetic-profile-save',
  ) {
    return request('versions', { expected, content, reason: 'Synthetic shared rule Save' }, key);
  }
  function preview(content: BidDefinitionContent, expected = legacy.expected) {
    return request('preview', {
      kind: 'profile-review',
      expected,
      intent: { operation: 'save', content },
    });
  }
  async function current(): Promise<Current> {
    const response = await request('current');
    expect(response.status).toBe(200);
    return response.json() as Promise<Current>;
  }
  function noRuns() {
    for (const table of [
      'bid_sessions',
      'bid_session_policy_snapshots',
      'canonical_bid_session_state',
      'bid_command_receipts',
      'bid_command_events',
    ]) {
      expect(h.sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({
        count: 0,
      });
    }
  }

  it('normal Save compiles pending profiles into immutable concrete rules with provenance without prior review', async () => {
    const draft = pending();
    const result = await save(draft);
    expect(result.status).toBe(201);
    const receipt = (await result.json()) as {
      versionId: string;
      versionNumber: number;
      contentSha256: string;
    };
    expect(receipt.versionNumber).toBe(1);
    const saved = await current();
    expect(saved.content.authoring?.reconciliation).toBe('MATERIALIZED_FOR_CURRENT_VERSION');
    expect(saved.content.rules).toHaveLength(1);
    const compiledRule = saved.content.rules[0];
    if (!compiledRule) throw new Error('Synthetic compiled rule missing');
    expect(saved.content.rules[0]?.positionId).toBe(SEAT);
    expect(JSON.parse(compiledRule.requiredCriteriaJson).custom).toEqual(['non_probationary']);
    expect(JSON.parse(compiledRule.pointsPreferenceJson).scoring.total[0].items[0].points).toBe(3);
    expect(saved.content.authoring?.compiled[0]).toMatchObject({
      rule: saved.content.rules[0],
      provenance: {
        requirements: ['synthetic-shared'],
        scoring: ['synthetic-shared'],
        priorities: ['synthetic-shared'],
        matched: ['synthetic-shared'],
      },
    });
    const persisted = h.sqlite
      .prepare('SELECT content_json,content_sha256 FROM bid_definition_versions WHERE id=?')
      .get(receipt.versionId) as { content_json: string; content_sha256: string };
    expect(JSON.parse(persisted.content_json)).toEqual(saved.content);
    expect(persisted.content_sha256).toBe(receipt.contentSha256);
    const bytes = h.sqlite.serialize();
    const replay = await save(draft);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ versionId: receipt.versionId, replayed: true });
    deepStrictEqual(h.sqlite.serialize(), bytes);
    expect(() =>
      h.sqlite
        .prepare('UPDATE bid_definition_versions SET reason=? WHERE id=?')
        .run('Synthetic forbidden rewrite', receipt.versionId),
    ).toThrow();
    noRuns();
  });

  it('rejects conflicting same-scope profiles atomically without choosing a scoring winner', async () => {
    const bytes = h.sqlite.serialize();
    const result = await save(pending(legacy.content, [profile('left', 3), profile('right', 7)]));
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ ok: false, error: 'profile_compilation_conflict' });
    deepStrictEqual(h.sqlite.serialize(), bytes);
    noRuns();
  });

  it('returns structured profile conflicts for pending scope edits before stale-rule coverage checks', async () => {
    const draft = pending(legacy.content, [profile('left', 3), profile('right', 7)]);
    draft.participation = [
      {
        positionId: SEAT,
        bidParticipation: 'RESERVED_NON_BIDDABLE',
        authoritativeSourceRef: 'Synthetic reviewed scope swap',
      },
    ];
    const bytes = h.sqlite.serialize();
    const response = await preview(draft);
    expect(response.status).toBe(200);
    const reviewed = BidProfileReviewResponseSchema.parse(await response.json());
    expect(reviewed).toMatchObject({
      valid: false,
      kind: 'PROFILE_COMPILATION_CONFLICT',
      source: {
        candidateContentSha256: bidContentHash(canonicalize(draft as unknown as JsonValue)),
      },
      profileMappings: [
        { id: 'left', positionIds: [RESERVED] },
        { id: 'right', positionIds: [RESERVED] },
      ],
      conflicts: [{ positionId: RESERVED, field: 'scoring' }],
    });
    deepStrictEqual(h.sqlite.serialize(), bytes);
    noRuns();
  });

  it('optional profile review is read-only and its materialization equals a subsequent normal Save', async () => {
    const draft = pending();
    const bytes = h.sqlite.serialize();
    const response = await preview(draft);
    expect(response.status).toBe(200);
    const reviewed = BidProfileReviewResponseSchema.parse(await response.json());
    expect(reviewed).toMatchObject({
      valid: true,
      kind: 'MATERIALIZED',
      profileMappings: [{ id: 'synthetic-shared', positionIds: [SEAT] }],
      summary: { affectedPositionIds: [SEAT] },
    });
    if (!reviewed.valid) throw new Error('Synthetic review failed');
    deepStrictEqual(h.sqlite.serialize(), bytes);
    noRuns();
    const result = await save(draft);
    expect(result.status).toBe(201);
    expect(await result.json()).toMatchObject({
      contentSha256: reviewed.materialized.contentSha256,
    });
    expect((await current()).content).toEqual(reviewed.materialized.content);
  });

  it('rejects a stale expected version in optional review without adding writes', async () => {
    expect((await save(legacy.content)).status).toBe(201);
    const bytes = h.sqlite.serialize();
    const response = await preview(pending());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'bid_definition_or_source_changed' });
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  it('rejects a Department source race during optional review and performs no writes of its own', async () => {
    expect((await save(legacy.content)).status).toBe(201);
    const base = await current();
    let raced = false;
    let afterRace: Buffer | undefined;
    const original = h.env.DB.prepare.bind(h.env.DB);
    vi.spyOn(h.env.DB, 'prepare').mockImplementation((sql) => {
      const statement = original(sql);
      if (!raced && /from\s+"members"/i.test(sql)) {
        const raw = statement.raw.bind(statement);
        vi.spyOn(statement, 'raw').mockImplementation(async <T = unknown[]>() => {
          const rows = await raw<T>();
          if (!raced) {
            h.sqlite.exec('UPDATE members SET is_probationary=1 WHERE id=10001');
            raced = true;
            afterRace = h.sqlite.serialize();
          }
          return rows;
        });
      }
      return statement;
    });
    const response = await preview(pending(base.content), base.expected);
    expect(raced).toBe(true);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'bid_definition_or_source_changed' });
    deepStrictEqual(h.sqlite.serialize(), afterRace);
  });

  it('restores historical content as a new immutable identity after an automatically compiled Save', async () => {
    const initial = await save(legacy.content);
    expect(initial.status).toBe(201);
    const first = (await initial.json()) as { versionId: string };
    const before = await current();
    expect(
      (await save(pending(before.content), before.expected, 'synthetic-profile-change')).status,
    ).toBe(201);
    const updated = await current();
    const restored = await request(
      'restore',
      {
        expected: updated.expected,
        versionId: first.versionId,
        reason: 'Synthetic historical restore after shared rules',
      },
      'synthetic-profile-restore',
    );
    expect(restored.status).toBe(201);
    expect(await restored.json()).toMatchObject({
      versionNumber: 3,
      restoredFromId: first.versionId,
    });
    expect((await current()).content).toEqual(before.content);
    if (!updated.version) throw new Error('Synthetic compiled version missing');
    const historical = await request(`versions/${updated.version.id}`);
    expect(historical.status).toBe(200);
    expect(((await historical.json()) as Current).content).toEqual(updated.content);
    noRuns();
  });

  it.each(['MATCHES_CAPTURED_RULE_REVISION', 'RULES_CHANGED_AFTER_COMPILATION'] as const)(
    'does not recompile %s historical material during optional restore review',
    async (reconciliation) => {
      const historical = pending();
      if (!historical.authoring) throw new Error('Synthetic profile authoring missing');
      historical.authoring.reconciliation = reconciliation;
      const first = await save(historical);
      expect(first.status).toBe(201);
      const receipt = (await first.json()) as { versionId: string };
      const baseline = await current();
      expect(
        (await save(pending(baseline.content), baseline.expected, 'synthetic-compiled-next'))
          .status,
      ).toBe(201);
      const latest = await current();
      const bytes = h.sqlite.serialize();
      const review = await request('preview', {
        kind: 'profile-review',
        expected: latest.expected,
        intent: { operation: 'restore', versionId: receipt.versionId },
      });
      expect(review.status).toBe(200);
      expect(await review.json()).toEqual({
        valid: false,
        kind: 'PROFILE_AUTHORING_UNAVAILABLE',
        code: 'restore_preserves_historical_concrete_rules',
      });
      deepStrictEqual(h.sqlite.serialize(), bytes);
      const restore = await request(
        'restore',
        {
          expected: latest.expected,
          versionId: receipt.versionId,
          reason: 'Synthetic restore retains historical concrete rules',
        },
        'synthetic-restore-exact',
      );
      expect(restore.status).toBe(201);
      expect((await current()).content).toEqual(baseline.content);
      expect((await current()).content.rules).not.toEqual(latest.content.rules);
      noRuns();
    },
  );

  it('preview and Save remove stale derived rules when closing scope and recompile them when reopening', async () => {
    expect((await save(pending())).status).toBe(201);
    const open = await current();
    const closedDraft = pending(open.content);
    closedDraft.participation = [
      ...closedDraft.participation.filter((row) => row.positionId !== SEAT),
      {
        positionId: SEAT,
        bidParticipation: 'RESERVED_NON_BIDDABLE',
        authoritativeSourceRef: 'Synthetic reviewed closed scope',
      },
    ];
    // UI marks the profile draft pending; the server removes this stale rule
    // before checking the new reserved scope. No client compilation is needed.
    expect(closedDraft.rules.map((rule) => rule.positionId)).toContain(SEAT);
    const beforeClosePreview = h.sqlite.serialize();
    const closePreview = await preview(closedDraft, open.expected);
    expect(closePreview.status).toBe(200);
    const reviewedClose = BidProfileReviewResponseSchema.parse(await closePreview.json());
    expect(reviewedClose).toMatchObject({ valid: true, kind: 'MATERIALIZED' });
    if (!reviewedClose.valid) throw new Error('Synthetic closing review failed');
    expect(reviewedClose.materialized.content.rules).toEqual([]);
    expect(reviewedClose.profileMappings).toMatchObject([{ positionIds: [] }]);
    deepStrictEqual(h.sqlite.serialize(), beforeClosePreview);
    const closeResult = await save(closedDraft, open.expected, 'synthetic-close-scope');
    expect(closeResult.status, JSON.stringify(await closeResult.clone().json())).toBe(201);
    expect(await closeResult.json()).toMatchObject({
      contentSha256: reviewedClose.materialized.contentSha256,
    });
    const closed = await current();
    expect(closed.content.rules).toEqual([]);
    expect(closed.content.authoring).toMatchObject({
      reconciliation: 'MATERIALIZED_FOR_CURRENT_VERSION',
      compiled: [],
    });

    const reopenedDraft = pending(closed.content);
    reopenedDraft.participation = reopenedDraft.participation.map((row) =>
      row.positionId === SEAT
        ? {
            ...row,
            bidParticipation: 'BIDDABLE',
            authoritativeSourceRef: 'Synthetic reviewed reopened scope',
          }
        : row,
    );
    expect(reopenedDraft.rules).toEqual([]);
    const beforeReopenPreview = h.sqlite.serialize();
    const reopenPreview = await preview(reopenedDraft, closed.expected);
    expect(reopenPreview.status).toBe(200);
    const reviewedReopen = BidProfileReviewResponseSchema.parse(await reopenPreview.json());
    expect(reviewedReopen).toMatchObject({ valid: true, kind: 'MATERIALIZED' });
    if (!reviewedReopen.valid) throw new Error('Synthetic reopening review failed');
    expect(reviewedReopen.materialized.content.rules).toEqual(open.content.rules);
    deepStrictEqual(h.sqlite.serialize(), beforeReopenPreview);
    const reopenResult = await save(reopenedDraft, closed.expected, 'synthetic-reopen-scope');
    expect(reopenResult.status, JSON.stringify(await reopenResult.clone().json())).toBe(201);
    expect(await reopenResult.json()).toMatchObject({
      contentSha256: reviewedReopen.materialized.contentSha256,
    });
    const reopened = await current();
    expect(reopened.content.rules).toEqual(open.content.rules);
    expect(reopened.content.authoring?.compiled).toEqual(open.content.authoring?.compiled);
    expect(reopened.version?.versionNumber).toBe(3);
    if (!closed.version) throw new Error('Synthetic closed version missing');
    const retainedClosed = await request(`versions/${closed.version.id}`);
    expect(((await retainedClosed.json()) as Current).content.rules).toEqual([]);
    noRuns();
  });
});
