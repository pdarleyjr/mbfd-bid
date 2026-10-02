import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { BidDefinitionContent } from '@mbfd/shared';
import Papa from 'papaparse';
import { expect, it } from 'vitest';
import { loadCanonicalBidSessionState } from '../../src/commands/canonical-command-service.js';
import { app } from '../../src/index.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';

const privateEnv = env as unknown as WorkerEnv & { OWNED_ENGINEERING_REPLAY?: string };

// Replay previously audited, explicitly synthetic operator choices into a new
// owned epoch. Import source metadata only: no session, fill, command receipt,
// canonical event, audit, or final-state row enters the new D1 database.
it.skipIf(!privateEnv.OWNED_ENGINEERING_REPLAY)(
  'completes an owned synthetic engineering Mock through actual HTTP, D1 and DO',
  async () => {
    if (!privateEnv.OWNED_ENGINEERING_REPLAY)
      throw new Error('Private engineering source required');
    const input = JSON.parse(privateEnv.OWNED_ENGINEERING_REPLAY) as {
      kind: string;
      bootstrapContainsZeroSessionOutcomes: boolean;
      tables: { name: string; columns: string[]; rows: Record<string, unknown>[] }[];
      definition: BidDefinitionContent;
      commands: Record<string, unknown>[];
      expectedAwards: (string | number)[][];
    };
    expect(input.kind).toBe('OWNED_SYNTHETIC_HTTP_D1_DO_REPLAY');
    expect(input.bootstrapContainsZeroSessionOutcomes).toBe(true);
    expect(input.commands).toHaveLength(234);
    expect(input.expectedAwards).toHaveLength(223);
    const allowedTables = new Set([
      'members',
      'credentials',
      'service_credit_types',
      'staffing_positions',
      'position_templates',
      'rule_books',
      'bid_years',
      'positions',
      'position_rules',
      'rule_book_position_participation',
      'position_staffing_bindings',
      'member_credentials',
      'member_service_evidence',
      'bid_ordinal_datasets',
    ]);
    for (const table of input.tables) {
      if (
        !allowedTables.has(table.name) ||
        table.columns.some((name) => !/^[a-z_][a-z0-9_]*$/.test(name))
      )
        throw new Error('Engineering source table invalid');
      const schema = await privateEnv.DB.prepare(`PRAGMA table_info(${table.name})`).all<{
        name: string;
      }>();
      expect(
        table.columns.every((name) => schema.results.some((column) => column.name === name)),
      ).toBe(true);
      if (table.name === 'service_credit_types') {
        // The migration owns this capability seed. Prove exact equality rather
        // than duplicate it or silently ignore an unexpected source conflict.
        const seeded = await privateEnv.DB.prepare(
          `SELECT ${table.columns.join(',')} FROM service_credit_types ORDER BY id`,
        ).all();
        expect(seeded.results).toEqual(
          [...table.rows].sort((left, right) => String(left.id).localeCompare(String(right.id))),
        );
      } else if (table.name === 'bid_years') {
        expect(table.rows).toHaveLength(1);
        const row = table.rows[0];
        if (!row) throw new Error('Owned engineering Bid year source row required');
        await privateEnv.DB.prepare(`UPDATE bid_years SET ${table.columns
          .filter((name) => name !== 'year')
          .map((name) => `${name}=?`)
          .join(',')}
          WHERE year=2026 AND status='configuring' AND rule_book_version IS NULL AND position_template_version IS NULL`)
          .bind(...table.columns.filter((name) => name !== 'year').map((name) => row[name]))
          .run();
      } else {
        for (let offset = 0; offset < table.rows.length; offset += 100)
          await privateEnv.DB.prepare(`INSERT INTO ${table.name} (${table.columns.join(',')})
            SELECT ${table.columns.map((name) => `json_extract(value,'$.${name}')`).join(',')} FROM json_each(?)`)
            .bind(JSON.stringify(table.rows.slice(offset, offset + 100)))
            .run();
      }
    }
    for (const table of [
      'bid_sessions',
      'canonical_bid_session_state',
      'bid_command_receipts',
      'bid_command_events',
      'bids',
      'member_assignments',
      'audit_log',
    ])
      expect(await privateEnv.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).toEqual({
        n: 0,
      });
    // Local fixture tokens use the actual canonical claim/signature contract.
    // Real Hub login and five-minute recovery are separately gated scenarios.
    async function request(path: string, body?: unknown) {
      const now = Math.floor(Date.now() / 1000);
      const token = await signJwt(
        {
          sub: 92000,
          hub_user_id: 92000,
          member_id: 92000,
          emp: 'SYNTHETIC-FINAL-92000',
          role: 'admin',
          rank: 'CPT',
          first_name: 'Synthetic',
          last_name: 'Operator',
          security_version: 1,
          authz_checked_at: now,
          fresh_auth_at: now,
        },
        privateEnv.JWT_SIGNING_KEY,
      );
      return app.fetch(
        new Request(`https://owned-engineering.invalid/api/admin/${path}`, {
          ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
        }),
        privateEnv,
      );
    }
    const source = await captureBidDefinitionSource(privateEnv.DB, 2026);
    expect(source.ok).toBe(true);
    if (!source.ok) throw new Error('Owned engineering source capture failed');
    const saveResponse = await request('bid/2026/versions', {
      content: input.definition,
      expected: { kind: 'legacy', sourceToken: source.sourceToken },
      reason: 'Owned actual runtime synthetic engineering source',
    });
    expect(saveResponse.status).toBe(201);
    const saved = (await saveResponse.json()) as { versionId: string; contentSha256: string };
    const selection = { versionId: saved.versionId, versionSha256: saved.contentSha256 };
    const previewResponse = await request('bid/2026/preview', { kind: 'mock', ...selection });
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as {
      wouldAllowCreateMock: boolean;
      contextSha256: string;
      runtimeSourceToken: string;
    };
    expect(preview.wouldAllowCreateMock).toBe(true);
    const createResponse = await request('bid/2026/mock-sessions', {
      ...selection,
      expectedContextSha256: preview.contextSha256,
      expectedSourceToken: preview.runtimeSourceToken,
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: string };
    const start = await request(`bid-session/${created.id}/start`, {});
    expect(start.status).toBe(200);
    const stub = env.BID_SESSION.get(env.BID_SESSION.idFromName(created.id));
    let expectedSeq = 0;
    for (const choice of input.commands) {
      const response = await request(`bid-session/${created.id}/commands/live`, {
        v: 1,
        ...choice,
        commandId: crypto.randomUUID(),
        expectedSeq,
        reason: 'Replay owned audited synthetic engineering operator choice',
        evidenceReference: 'local:synthetic-engineering-choice',
      });
      const result = (await response.json()) as { kind: string; seq: number; code?: string };
      expect(
        response.status,
        `Command ${expectedSeq + 1} ${choice.type}: ${result.code ?? result.kind}`,
      ).toBe(200);
      expect(result.kind).toBe('accepted');
      expect(result.seq).toBe(++expectedSeq);
      if (expectedSeq === 100) {
        const before = await loadCanonicalBidSessionState(privateEnv.DB, created.id);
        let previous: unknown;
        await runInDurableObject(stub, async (instance) => {
          previous = instance;
        });
        await evictDurableObject(stub);
        await stub.fetch('https://owned-engineering-do/snapshot');
        await runInDurableObject(stub, async (instance) => expect(instance).not.toBe(previous));
        expect(await loadCanonicalBidSessionState(privateEnv.DB, created.id)).toEqual(before);
      }
    }
    const final = await loadCanonicalBidSessionState(privateEnv.DB, created.id);
    expect(final?.currentPhase).toBe('complete');
    expect(final?.lastSeq).toBe(234);
    expect(Object.keys(final?.fills ?? {})).toHaveLength(223);
    const resultsResponse = await request(`bid-session/${created.id}/results`);
    expect(resultsResponse.status).toBe(200);
    const results = (await resultsResponse.json()) as {
      awardSource: string;
      awards: { positionId: string; memberId: number; aDay: string }[];
    };
    expect(results.awardSource).toBe('CANONICAL');
    expect(
      results.awards.map((award) => [award.positionId, award.memberId, award.aDay]).sort(),
    ).toEqual(input.expectedAwards);
    for (const [kind, path, count] of [
      ['placements', `placements/export?bid_session_id=${created.id}`, 223],
      ['progress', `exports/${created.id}/progress.csv`, 1],
      ['audit', `audit/export?bid_session_id=${created.id}`, 236],
    ] as const) {
      const response = await request(path);
      expect(response.status).toBe(200);
      const csv = Papa.parse<Record<string, string>>(await response.text(), {
        header: true,
        skipEmptyLines: true,
      });
      expect(csv.errors).toEqual([]);
      expect(csv.data).toHaveLength(count);
      if (kind === 'placements')
        expect(
          csv.data.map((award) => [award.position_id, Number(award.member_id), award.a_day]).sort(),
        ).toEqual(input.expectedAwards);
    }
    expect(await privateEnv.DB.prepare('SELECT count(*) AS n FROM bids').first()).toEqual({ n: 0 });
    expect(
      await privateEnv.DB.prepare('SELECT count(*) AS n FROM member_assignments').first(),
    ).toEqual({ n: 0 });
    expect(
      await privateEnv.DB.prepare('SELECT count(*) AS n FROM bid_sessions WHERE is_mock=0').first(),
    ).toEqual({ n: 0 });
  },
  1800000,
);
