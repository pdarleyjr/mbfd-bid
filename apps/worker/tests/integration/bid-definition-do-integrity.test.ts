import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  type BidSessionPolicySnapshot,
  BidSessionPolicySnapshotSchema,
  type MockFreezeCommand,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { BidSessionDO } from '../../src/durable/bid-session.js';
import { bidDefinitionContextHash } from '../../src/lib/bid-definition-context.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const SESSION = '01HZZ0000000000000PINRUN1';
const OPAQUE = 'synthetic-opaque-managed-do';
const STATE_KEY = `bs:${OPAQUE}:state`;
const PIN_KEY = `bid-definition-pin:${OPAQUE}`;
const NOW = Date.parse('2027-01-01T10:00:00.000Z');
const ORDER: BidSessionState['bidOrder'] = [{ ordinal: 1, memberId: 10001, pool: 'FF' }];
type Version = Extract<Awaited<ReturnType<typeof loadBidDefinitionVersion>>, { ok: true }>;
type Snapshot = Extract<BidSessionPolicySnapshot, { v: 3 }>;
type Pins = {
  bidVersionId: string;
  bidVersionSha256: string;
  snapshotSha256: string;
  contextSha256: string;
};

function makeStorage() {
  const data = new Map<string, unknown>();
  const puts: string[] = [];
  let failState = false;
  return {
    data,
    puts,
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return structuredClone(data.get(key)) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      puts.push(key);
      if (failState && key.endsWith(':state')) {
        failState = false;
        throw new Error('simulated managed projection write failure');
      }
      data.set(key, structuredClone(value));
    },
    async delete(key: string) {
      return data.delete(key);
    },
    async list<T>(prefix: string): Promise<Map<string, T>> {
      return new Map([...data].filter(([key]) => key.startsWith(prefix)) as [string, T][]);
    },
    failNextStatePut() {
      failState = true;
    },
  };
}
type Storage = ReturnType<typeof makeStorage>;

function makeState(storage: Storage): DurableObjectState {
  return {
    id: { toString: () => OPAQUE, equals: () => false, name: SESSION },
    storage,
    async blockConcurrencyWhile<T>(fn: () => Promise<T>) {
      return fn();
    },
    waitUntil() {},
    acceptWebSocket() {},
    getWebSockets: () => [],
    setHibernatableWebSocketEventTimeout() {},
    getHibernatableWebSocketEventTimeout: () => null,
    setWebSocketAutoResponse() {},
    getWebSocketAutoResponseTimestamp: () => null,
    abort() {},
  } as unknown as DurableObjectState;
}

function command(): MockFreezeCommand {
  return {
    v: 1,
    type: 'mock.freeze',
    commandId: '11111111-1111-4111-8111-111111111160',
    bidSessionId: SESSION,
    expectedSeq: 1,
    actor: { id: 10001, role: 'admin' },
    reason: 'Synthetic managed pause',
  };
}

describe('managed Bid durable projection integrity', () => {
  let h: TestD1;
  let storage: Storage;
  let version: Version;
  let pins: Pins;
  let instance: BidSessionDO;

  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
        VALUES (10001,'synthetic-do-editor','Synthetic','Editor','FF','FF',1,1,1);
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic topology');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',4,'Synthetic source');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',3,'{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-01","personnelEvaluationOn":"2027-01-01"}');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('synthetic-do-seat','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic firefighter');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','synthetic-do-seat','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}','{"max":0,"items":[]}','["rsc_seniority"]');
    `);
    const captured = await captureBidDefinitionSource(h.env.DB, 2027);
    if (!captured.ok) throw new Error(JSON.stringify(captured));
    const saved = await saveBidDefinition(h.env.DB, {
      year: 2027,
      key: 'synthetic-do-adoption',
      actorSubject: 'synthetic-editor',
      actorId: 10001,
      expected: { kind: 'legacy', sourceToken: captured.sourceToken },
      reason: 'Synthetic managed DO fixture',
      intent: { operation: 'save', content: captured.content },
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const loaded = await loadBidDefinitionVersion(h.env.DB, 2027, String(saved.response.versionId));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    version = loaded;
    if (version.content.settings?.v !== 2) throw new Error('Synthetic V2 settings required');
    const base = BidSessionPolicySnapshotSchema.parse({
      v: 3,
      ruleBookVersion: version.row.rule_book_version,
      ruleBookRevision: version.row.rule_book_revision,
      positionTemplateVersion: version.row.position_template_version,
      configurationRevision: version.row.version_number,
      settings: version.content.settings,
      credentialEvaluationOn: version.content.settings.credentialEvaluationOn,
      capturedAtMs: NOW,
      members: [
        {
          memberId: 10001,
          pool: 'FF',
          rscSeniority: 1,
          rankSeniority: 1,
          exclusionReason: null,
          authoritativeAssignmentId: null,
          rank: 'FF',
          isProbationary: false,
          credentialNames: [],
        },
      ],
      ruleBookMaterial: {
        v: 1,
        rules: version.content.rules.map(({ notes: _notes, ...rule }) => ({
          ...rule,
          ruleBookVersion: version.row.rule_book_version,
          templateVersion: version.row.position_template_version,
        })),
        positions: version.content.positions.map((position) => ({
          ...position,
          templateVersion: version.row.position_template_version,
          bidParticipation: 'BIDDABLE',
        })),
      },
    }) as Snapshot;
    const context = bidDefinitionContextHash(base);
    const body = {
      ...base,
      bidDefinition: {
        v: 1,
        bidSessionId: SESSION,
        bidYear: 2027,
        versionId: version.row.id,
        versionSha256: version.sha256,
        contextSha256: context,
      },
    };
    const json = JSON.stringify(body);
    pins = {
      bidVersionId: version.row.id,
      bidVersionSha256: version.sha256,
      snapshotSha256: createHash('sha256').update(json, 'utf8').digest('hex'),
      contextSha256: context,
    };
    h.sqlite
      .prepare(`INSERT INTO bid_sessions (id,bid_year,started_at,current_phase,is_mock,turn_timer_seconds,expected_duration_days)
      VALUES (?,2027,?,'config',1,180,2)`)
      .run(SESSION, NOW);
    h.sqlite
      .prepare(`INSERT INTO bid_session_policy_snapshots
      (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at,bid_version_id,bid_version_sha256,snapshot_sha256,context_sha256)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(
        SESSION,
        version.row.rule_book_version,
        version.row.position_template_version,
        version.row.rule_book_revision,
        json,
        NOW,
        pins.bidVersionId,
        pins.bidVersionSha256,
        pins.snapshotSha256,
        pins.contextSha256,
      );
    storage = makeStorage();
    instance = new BidSessionDO(makeState(storage), h.env);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  async function initialize() {
    await instance.initSession({ bidOrder: ORDER, turnTimerSeconds: 180 });
    expect(storage.data.get(PIN_KEY)).toEqual(pins);
    expect(storage.data.get(STATE_KEY)).toMatchObject({ lastSeq: 1, currentPhase: 'position_bid' });
  }

  function spyBroadcast(target: BidSessionDO) {
    return vi.spyOn(target as unknown as { broadcast(value: unknown): void }, 'broadcast');
  }

  async function expectRejectedWithoutEffects(target: BidSessionDO) {
    const dbBefore = h.sqlite.serialize();
    const before = structuredClone([...storage.data]);
    const putCount = storage.puts.length;
    const broadcast = spyBroadcast(target);
    await expect(target.fetch(new Request('https://do/snapshot'))).rejects.toThrow(
      'session_policy_snapshot_integrity_invalid',
    );
    await expect(target.adminMockFreezeCommand(command())).rejects.toThrow(
      'session_policy_snapshot_integrity_invalid',
    );
    deepStrictEqual(h.sqlite.serialize(), dbBefore);
    expect([...storage.data]).toEqual(before);
    expect(storage.puts.length).toBe(putCount);
    expect(broadcast).not.toHaveBeenCalled();
  }

  function corruptSnapshot(sql: string, remove = false) {
    // Isolated recovery-corruption simulation only: suspend one relevant guard,
    // alter the synthetic row, restore it, and retain every FK and source seal.
    const name = remove
      ? 'bid_session_policy_snapshots_pinned_no_delete'
      : 'bid_session_policy_snapshots_immutable';
    const guard = h.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?")
      .get(name) as { sql: string };
    h.sqlite.exec(`DROP TRIGGER ${name}`);
    try {
      h.sqlite.exec(sql);
    } finally {
      h.sqlite.exec(guard.sql);
    }
  }

  it('writes the verified tuple before the initial local projection, preserving named and opaque identities', async () => {
    const dbBefore = h.sqlite.serialize();
    await initialize();
    expect(storage.puts).toEqual([PIN_KEY, STATE_KEY]);
    expect(storage.data.has(`bid-definition-pin:${SESSION}`)).toBe(false);
    expect(storage.data.get(STATE_KEY)).toMatchObject({ bidSessionId: OPAQUE });
    deepStrictEqual(h.sqlite.serialize(), dbBefore);
  });

  it('retains the verified marker if the initial local projection write fails', async () => {
    storage.failNextStatePut();
    await expect(instance.initSession({ bidOrder: ORDER, turnTimerSeconds: 180 })).rejects.toThrow(
      'simulated managed projection write failure',
    );
    expect(storage.data.get(PIN_KEY)).toEqual(pins);
    expect(storage.data.has(STATE_KEY)).toBe(false);
    const cold = new BidSessionDO(makeState(storage), h.env);
    const response = await cold.fetch(new Request('https://do/snapshot'));
    expect(await response.json()).toMatchObject({ currentPhase: 'config', lastSeq: 0 });
  });

  it('recovers the committed canonical projection after a failed write and a later version head', async () => {
    await initialize();
    storage.failNextStatePut();
    await expect(instance.adminMockFreezeCommand(command())).rejects.toThrow(
      'simulated managed projection write failure',
    );
    expect(storage.data.get(PIN_KEY)).toEqual(pins);
    expect(storage.data.get(STATE_KEY)).toMatchObject({ lastSeq: 1 });
    const next = await saveBidDefinition(h.env.DB, {
      year: 2027,
      key: 'synthetic-do-successor',
      actorSubject: 'synthetic-editor',
      actorId: 10001,
      expected: { kind: 'version', versionId: version.row.id, revision: 1, sha256: version.sha256 },
      reason: 'Synthetic future version without changing this run',
      intent: {
        operation: 'save',
        content: {
          ...version.content,
          notes: { ...version.content.notes, bid: 'Synthetic future notes' },
        },
      },
    });
    if (!next.ok) throw new Error(JSON.stringify(next));
    expect(next.response.versionId).not.toBe(version.row.id);
    const cold = new BidSessionDO(makeState(storage), h.env);
    const broadcast = spyBroadcast(cold);
    const dbBefore = h.sqlite.serialize();
    const response = await cold.fetch(new Request('https://do/snapshot'));
    expect(await response.json()).toMatchObject({
      bidSessionId: OPAQUE,
      currentPhase: 'paused',
      lastSeq: 2,
    });
    expect(storage.data.get(STATE_KEY)).toMatchObject({ lastSeq: 2 });
    expect(storage.data.get(PIN_KEY)).toEqual(pins);
    expect(broadcast).not.toHaveBeenCalled();
    deepStrictEqual(h.sqlite.serialize(), dbBefore);
  });

  it('rejects missing snapshot metadata before recovering or replaying a previously accepted command', async () => {
    await initialize();
    expect((await instance.adminMockFreezeCommand(command())).kind).toBe('accepted');
    corruptSnapshot(
      `DELETE FROM bid_session_policy_snapshots WHERE bid_session_id='${SESSION}'`,
      true,
    );
    await expectRejectedWithoutEffects(new BidSessionDO(makeState(storage), h.env));
  });

  it.each([
    "snapshot_json=snapshot_json || ' '",
    `snapshot_sha256='${'3'.repeat(64)}'`,
    `context_sha256='${'3'.repeat(64)}'`,
    'bid_version_id=NULL',
    'bid_version_id=NULL,bid_version_sha256=NULL,snapshot_sha256=NULL,context_sha256=NULL',
    "bid_version_id=NULL,bid_version_sha256=NULL,snapshot_sha256=NULL,context_sha256=NULL,snapshot_json=json_remove(snapshot_json,'$.bidDefinition')",
  ])(
    'rejects corrupted stored pins (%s) before local writes, receipt replay or broadcast',
    async (change) => {
      await initialize();
      expect((await instance.adminMockFreezeCommand(command())).kind).toBe('accepted');
      corruptSnapshot(
        `UPDATE bid_session_policy_snapshots SET ${change} WHERE bid_session_id='${SESSION}'`,
      );
      await expectRejectedWithoutEffects(new BidSessionDO(makeState(storage), h.env));
    },
  );

  it.each(['bidVersionId', 'bidVersionSha256', 'snapshotSha256', 'contextSha256'] as const)(
    'rejects marker %s mismatch even though the D1 snapshot remains valid',
    async (key) => {
      await initialize();
      storage.data.set(PIN_KEY, {
        ...pins,
        [key]: key === 'bidVersionId' ? 'synthetic-other-version' : '3'.repeat(64),
      });
      await expectRejectedWithoutEffects(new BidSessionDO(makeState(storage), h.env));
    },
  );

  it.each([null, false, 'legacy', [], {}, { bidVersionId: 'partial' }, { extra: 'unexpected' }])(
    'rejects malformed durable marker %j locally even when D1 is unavailable',
    async (marker) => {
      storage.data.set(PIN_KEY, marker);
      const unavailable = { ...h.env, DB: undefined } as unknown as typeof h.env;
      const cold = new BidSessionDO(makeState(storage), unavailable);
      await expectRejectedWithoutEffects(cold);
    },
  );

  it.each(['all', 'bidVersionId', 'bidVersionSha256', 'snapshotSha256', 'contextSha256'])(
    'rejects null marker values (%s) before attempting unavailable D1',
    async (key) => {
      storage.data.set(
        PIN_KEY,
        key === 'all'
          ? Object.fromEntries(Object.keys(pins).map((field) => [field, null]))
          : { ...pins, [key]: null },
      );
      const unavailable = { ...h.env, DB: undefined } as unknown as typeof h.env;
      await expectRejectedWithoutEffects(new BidSessionDO(makeState(storage), unavailable));
    },
  );

  it('keeps an established managed marker fail-closed during a D1 outage', async () => {
    await initialize();
    const prepare = vi.fn(() => {
      throw new Error('synthetic D1 outage');
    });
    const cold = new BidSessionDO(makeState(storage), {
      ...h.env,
      DB: { prepare },
    } as unknown as typeof h.env);
    const before = structuredClone([...storage.data]);
    const puts = storage.puts.length;
    const broadcast = spyBroadcast(cold);
    await expect(cold.fetch(new Request('https://do/snapshot'))).rejects.toThrow(
      'synthetic D1 outage',
    );
    expect([...storage.data]).toEqual(before);
    expect(storage.puts.length).toBe(puts);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('retains local legacy snapshots with no marker despite an unknown D1 outage', async () => {
    const local = {
      ...emptyBidSessionState(OPAQUE),
      currentPhase: 'position_bid' as const,
      lastSeq: 7,
    };
    storage.data.set(STATE_KEY, local);
    const prepare = vi.fn(() => {
      throw new Error('synthetic unknown D1 outage');
    });
    const cold = new BidSessionDO(makeState(storage), {
      ...h.env,
      DB: { prepare },
    } as unknown as typeof h.env);
    const response = await cold.fetch(new Request('https://do/snapshot'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(local);
    expect(prepare).not.toHaveBeenCalled();
    expect(storage.puts).toEqual([]);
  });
});
