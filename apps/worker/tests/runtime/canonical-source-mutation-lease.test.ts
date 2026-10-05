import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { bidSessionNormalMutationLeaseStorageKey } from '../../src/durable/bid-session.js';

describe('canonical command source mutation serialization', () => {
  it.each(['active', 'unknown'] as const)(
    'blocks a new command while the normal mutation permit is %s without changing progress',
    async (kind) => {
      const sessionId = `synthetic-canonical-source-lease-${kind}`;
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO bid_years (year,status) VALUES (2040,'configuring')"),
        env.DB.prepare(`INSERT INTO bid_sessions
          (id,bid_year,started_at,current_phase,turn_timer_seconds,expected_duration_days,day_count,is_mock)
          VALUES (?,2040,1,'position_bid',180,2,0,1)`).bind(sessionId),
      ]);
      const stub = env.BID_SESSION.get(env.BID_SESSION.idFromName(sessionId));
      await stub.fetch('https://do/snapshot');
      if (kind === 'active') {
        const acquired = await stub.fetch('https://do/admin/normal-mutation-lease/acquire', {
          method: 'POST',
        });
        expect(acquired.status).toBe(200);
      } else {
        await runInDurableObject(stub, async (instance) => {
          const subject = instance as unknown as {
            storage: { put(key: string, value: unknown): Promise<void> };
          };
          await subject.storage.put(bidSessionNormalMutationLeaseStorageKey(sessionId), {
            malformed: true,
          });
        });
      }
      const response = await stub.fetch('https://do/admin/commands/live', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          v: 1,
          type: 'live.pause',
          commandId: crypto.randomUUID(),
          bidSessionId: sessionId,
          expectedSeq: 0,
          actor: { id: 1, role: 'admin' },
          reason: '',
          evidenceReference: null,
        }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: 'rejected',
        code: kind === 'active' ? 'NORMAL_MUTATION_LEASE_ACTIVE' : 'NORMAL_MUTATION_LEASE_UNKNOWN',
        currentSeq: 0,
      });
      expect(
        await env.DB.prepare('SELECT current_phase FROM bid_sessions WHERE id=?')
          .bind(sessionId)
          .first(),
      ).toEqual({ current_phase: 'position_bid' });
      expect(
        await env.DB.prepare(
          'SELECT count(*) AS n FROM canonical_bid_session_state WHERE bid_session_id=?',
        )
          .bind(sessionId)
          .first(),
      ).toEqual({ n: 0 });
      expect(
        await env.DB.prepare(
          'SELECT count(*) AS n FROM bid_command_receipts WHERE bid_session_id=?',
        )
          .bind(sessionId)
          .first(),
      ).toEqual({ n: 0 });
    },
  );
});
