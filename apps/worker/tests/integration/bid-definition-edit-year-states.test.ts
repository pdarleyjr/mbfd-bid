import { deepStrictEqual } from 'node:assert';
import {
  type BidDefinitionContent,
  BidDispositionSchema,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitMockFreezeCommand,
  loadCanonicalBidSessionState,
} from '../../src/commands/canonical-command-service.js';
import { getDb } from '../../src/db/index.js';
import { app } from '../../src/index.js';
import { loadFrozenSessionBidPolicy } from '../../src/lib/bid-policy.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const YEAR = 2026;
const BOOK = '2026.1';
const SEAT = 'synthetic-unlocked-edit-seat';
type Current = {
  content: BidDefinitionContent;
  expected:
    | { kind: 'legacy'; sourceToken: string }
    | { kind: 'version'; versionId: string; revision: number; sha256: string };
};
type Receipt = {
  versionId: string;
  versionNumber: number;
  contentSha256: string;
  predecessorId: string | null;
  restoredFromId: string | null;
};

function initialPolicy() {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-editing-baseline',
    stages: [
      {
        id: 'FF',
        label: 'Firefighters',
        order: 1,
        memberIds: [10001],
        opportunityPositionIds: [SEAT],
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
      actorMemberIds: [10001],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
  });
}

describe('versioned editing is independent of year and session execution state', () => {
  let h: TestD1;
  let token: string;
  let counter: number;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    counter = 0;
    h.sqlite.exec(`
      INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,rank_seniority,is_probationary,employment_status,employment_status_effective_on,created_at,updated_at)
      VALUES (10001,'synthetic-unlocked-editor','Synthetic','Editor','FF','FF',1,1,0,'active','2020-01-01',1,1);
      INSERT INTO position_templates(version,effective_year) VALUES ('${BOOK}',${YEAR});
      INSERT INTO rule_books(version,effective_year,status,revision) VALUES ('${BOOK}',${YEAR},'draft',0);
      INSERT INTO bid_years(year,status,rule_book_version,position_template_version,configuration_revision,config_json)
      VALUES (${YEAR},'configuring','${BOOK}','${BOOK}',1,
        '{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2026-01-01","personnelEvaluationOn":"2026-01-01"}');
      INSERT INTO positions(id,template_version,shift,station,division,unit,rank_required,position_name)
      VALUES ('${SEAT}','${BOOK}','A','7','Combat','Synthetic Engine','FF','Synthetic firefighter');
      INSERT INTO position_rules(rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
      VALUES ('${BOOK}','${SEAT}','${BOOK}','{"rank":["FF"],"credentials":[],"custom":[]}',
        '{"max":0,"items":[]}','["rsc_seniority"]');
      UPDATE rule_books SET status='active' WHERE version='${BOOK}';
    `);
    token = await signJwt(
      {
        sub: 10001,
        emp: 'synthetic-unlocked-editor',
        role: 'admin',
        rank: 'FF',
        first_name: 'Synthetic',
        last_name: 'Editor',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  function request(path: string, body?: unknown) {
    return app.fetch(
      new Request(`http://x/api/admin/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `synthetic-simple-edit-${++counter}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      h.env,
    );
  }
  async function current() {
    const response = await request(`bid/${YEAR}/current`);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as Current;
  }
  async function save(content: BidDefinitionContent, expected: Current['expected']) {
    const response = await request(`bid/${YEAR}/versions`, {
      content,
      expected,
      reason: 'Saved changes to policy language and eligibility.',
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json()) as Receipt;
  }
  async function createMock(version: Receipt) {
    const selection = { versionId: version.versionId, versionSha256: version.contentSha256 };
    const preview = await request(`bid/${YEAR}/preview`, { kind: 'mock', ...selection });
    expect(preview.status, await preview.clone().text()).toBe(200);
    const reviewed = (await preview.json()) as {
      contextSha256: string;
      runtimeSourceToken: string;
    };
    const response = await request(`bid/${YEAR}/mock-sessions`, {
      ...selection,
      expectedContextSha256: reviewed.contextSha256,
      expectedSourceToken: reviewed.runtimeSourceToken,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json()) as { id: string };
  }
  function executionRecords() {
    return Object.fromEntries(
      [
        'bid_years',
        'bid_sessions',
        'bid_session_policy_snapshots',
        'bid_order',
        'canonical_bid_session_state',
        'bid_command_receipts',
        'bid_command_events',
        'bid_audit_outbox',
      ].map((table) => [table, h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
    );
  }

  it.each(['configuring', 'live', 'paused', 'complete', 'archived'] as const)(
    'saves language/rule changes and restores in a %s year without unlocking or retargeting frozen runs',
    async (yearStatus) => {
      h.sqlite.prepare('UPDATE bid_years SET status=? WHERE year=?').run(yearStatus, YEAR);
      const originalYear = h.sqlite.prepare('SELECT * FROM bid_years WHERE year=?').get(YEAR);
      const designatedBook = h.sqlite.prepare('SELECT * FROM rule_books WHERE version=?').get(BOOK);
      expect(designatedBook).toMatchObject({ status: 'active' });
      const legacy = await current();
      const initial = structuredClone(legacy.content);
      const execution = initialPolicy();
      initial.settings = {
        v: 3,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2026-01-01',
        personnelEvaluationOn: '2026-01-01',
        livePolicy: execution,
      };
      initial.policy = {
        policyText: 'Synthetic baseline policy language for administrator practice.',
        executionPolicy: execution,
      };
      // Adoption itself is allowed in every year state while its designated
      // rule book remains active; no unlock endpoint is called.
      const first = await save(initial, legacy.expected);
      const active = await createMock(first);
      const started = await request(`bid-session/${active.id}/start`, {});
      expect(started.status, await started.clone().text()).toBe(200);
      const historical = await createMock(first);
      // A completed-phase fixture exercises historical row preservation only;
      // it does not stand in for an accepted canonical completion receipt.
      h.sqlite
        .prepare("UPDATE bid_sessions SET current_phase='complete',completed_at=2 WHERE id=?")
        .run(historical.id);
      h.sqlite
        .prepare(
          'UPDATE bid_sessions SET frozen_at=3,freeze_actor_id=10001,freeze_reason=? WHERE id=?',
        )
        .run('Synthetic frozen historical evidence', historical.id);
      const state = await loadCanonicalBidSessionState(h.env.DB, active.id);
      if (!state) throw new Error('Started canonical Mock required');
      const frozenActive = await commitMockFreezeCommand({
        db: h.env.DB,
        state,
        command: {
          v: 1,
          type: 'mock.freeze',
          commandId: '517856c7-f4c0-4c86-96bd-7dcf78ea5d51',
          bidSessionId: active.id,
          expectedSeq: state.lastSeq,
          actor: { id: 10001, role: 'admin' },
          reason: 'Synthetic frozen execution evidence',
        },
      });
      expect(frozenActive.result.kind).toBe('accepted');
      expect(frozenActive.canonicalState?.frozenAt).toEqual(expect.any(Number));
      const records = executionRecords();
      const originalVersion = h.sqlite
        .prepare('SELECT * FROM bid_definition_versions WHERE id=?')
        .get(first.versionId);
      const originalSnapshots = await Promise.all(
        [active, historical].map(async (session) => {
          const frozen = await loadFrozenSessionBidPolicy(getDb(h.env.DB), session.id);
          expect(frozen.ok).toBe(true);
          return frozen;
        }),
      );

      const beforeEdit = await current();
      const changed = structuredClone(beforeEdit.content);
      if (!changed.policy) throw new Error('Synthetic policy required');
      changed.policy.policyText =
        'Synthetic revised policy language: participants must be non-probationary.';
      const rule = changed.rules.find((entry) => entry.positionId === SEAT);
      if (!rule) throw new Error('Synthetic rule required');
      rule.requiredCriteriaJson = '{"rank":["FF"],"credentials":[],"custom":["non_probationary"]}';
      const second = await save(changed, beforeEdit.expected);
      expect(second).toMatchObject({
        versionNumber: 2,
        predecessorId: first.versionId,
        restoredFromId: null,
      });
      expect(second.versionId).not.toBe(first.versionId);
      expect(second.contentSha256).not.toBe(first.contentSha256);
      const editedVersion = h.sqlite
        .prepare('SELECT * FROM bid_definition_versions WHERE id=?')
        .get(second.versionId);
      const edited = await current();
      expect(edited.content.policy?.policyText).toBe(changed.policy.policyText);
      expect(
        JSON.parse(
          edited.content.rules.find((entry) => entry.positionId === SEAT)?.requiredCriteriaJson ??
            '{}',
        ),
      ).toMatchObject({ custom: ['non_probationary'] });
      expect(executionRecords()).toEqual(records);

      const restoredResponse = await request(`bid/${YEAR}/restore`, {
        expected: edited.expected,
        versionId: first.versionId,
        reason: 'Restored version 1.',
      });
      expect(restoredResponse.status, await restoredResponse.clone().text()).toBe(201);
      const restored = (await restoredResponse.json()) as Receipt;
      expect(restored).toMatchObject({
        versionNumber: 3,
        predecessorId: second.versionId,
        restoredFromId: first.versionId,
        contentSha256: first.contentSha256,
      });
      expect(restored.versionId).not.toBe(first.versionId);
      expect(restored.versionId).not.toBe(second.versionId);
      expect((await current()).content).toEqual(beforeEdit.content);
      expect(
        h.sqlite
          .prepare(
            'SELECT version_number FROM bid_definition_versions WHERE bid_year=? ORDER BY version_number',
          )
          .all(YEAR),
      ).toEqual([{ version_number: 1 }, { version_number: 2 }, { version_number: 3 }]);
      expect(
        h.sqlite.prepare('SELECT * FROM bid_definition_versions WHERE id=?').get(first.versionId),
      ).toEqual(originalVersion);
      expect(
        h.sqlite.prepare('SELECT * FROM bid_definition_versions WHERE id=?').get(second.versionId),
      ).toEqual(editedVersion);
      expect(h.sqlite.prepare('SELECT * FROM bid_years WHERE year=?').get(YEAR)).toEqual(
        originalYear,
      );
      expect(h.sqlite.prepare('SELECT * FROM rule_books WHERE version=?').get(BOOK)).toEqual(
        designatedBook,
      );
      expect(executionRecords()).toEqual(records);
      const beforeRead = h.sqlite.serialize();
      expect(
        await Promise.all(
          [active, historical].map((session) =>
            loadFrozenSessionBidPolicy(getDb(h.env.DB), session.id),
          ),
        ),
      ).toEqual(originalSnapshots);
      deepStrictEqual(h.sqlite.serialize(), beforeRead);
      expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    },
  );
});
