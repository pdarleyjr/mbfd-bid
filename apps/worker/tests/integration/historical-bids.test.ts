import { createHash } from 'node:crypto';
import { type HistoricalBid, HistoricalBidSchema } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'h'.repeat(64);
const fixture = (): HistoricalBid => ({
  schemaVersion: 1,
  year: 2025,
  label: 'Synthetic historical test',
  notes: ['Station 6 was not in service.'],
  sources: [{ id: 'synthetic', name: 'Synthetic document', sha256: 'a'.repeat(64) }],
  seats: [
    {
      id: 'A601',
      shift: 'A',
      station: 'Rescue Float Pool',
      unit: 'Rescue Float Pool',
      position: 'Lieutenant (R)',
      name: 'Synthetic historical winner',
      group: 'GR2',
      status: 'AWARDED',
      sourceId: 'synthetic',
      sourceLocation: 'Synthetic row 1',
      note: null,
    },
    {
      id: 'A215',
      shift: 'A',
      station: 'Station #2',
      unit: 'Float 2',
      position: 'Lieutenant #2 (R)',
      name: null,
      group: null,
      status: 'WITHDRAWN',
      sourceId: 'synthetic',
      sourceLocation: 'Synthetic row 2',
      note: null,
    },
  ],
});

describe('isolated immutable historical archives', () => {
  let h: TestD1;
  let objects: Map<string, string>;
  let admin: string;
  beforeEach(async () => {
    h = await setupTestD1();
    objects = new Map();
    admin = await signJwt(
      {
        sub: 0,
        emp: 'synthetic-admin',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Admin',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      KEY,
    );
    h.env.JWT_SIGNING_KEY = KEY;
    h.env.R2_EXPORTS = {
      get: async (key: string) =>
        objects.has(key) ? { json: async () => JSON.parse(objects.get(key) ?? '') } : null,
      put: async (key: string, value: string, options: R2PutOptions) => {
        expect((options.onlyIf as Headers).get('If-None-Match')).toBe('*');
        if (objects.has(key)) return null;
        objects.set(key, value);
        return { key };
      },
      list: async ({ prefix }: { prefix: string }) => ({
        objects: [...objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({ key })),
        truncated: false,
      }),
    } as unknown as typeof h.env.R2_EXPORTS;
  });
  afterEach(async () => teardownTestD1(h));
  const request = (method = 'GET', body?: unknown, path = '', token?: string) =>
    app.fetch(
      new Request(`http://x/api/admin/historical-bids${path}`, {
        method,
        headers: { Authorization: `Bearer ${token ?? admin}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      h.env,
    );

  it('requires admin authorization for reads and writes', async () => {
    const member = await signJwt(
      {
        sub: 0,
        emp: 'synthetic-member',
        role: 'member',
        rank: 'FF',
        first_name: 'Synthetic',
        last_name: 'Member',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      KEY,
    );
    for (const method of ['GET', 'POST']) {
      expect(
        (await request(method, method === 'POST' ? fixture() : undefined, '', 'invalid')).status,
      ).toBe(401);
      expect(
        (await request(method, method === 'POST' ? fixture() : undefined, '', member)).status,
      ).toBe(403);
    }
    expect(objects.size).toBe(0);
  });
  it('publishes and reads history without changing any database byte, current staffing or annual configuration', async () => {
    h.sqlite.exec(
      "INSERT INTO bid_years(year, status, position_template_version, rule_book_version) VALUES (2026, 'setup', '2026.1', '2026.1')",
    );
    const before = createHash('sha256').update(new Uint8Array(h.sqlite.serialize())).digest('hex');
    const published = await request('POST', fixture());
    expect(published.status).toBe(201);
    const receipt = (await published.json()) as { sha256: string };
    expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
    const read = await request('GET', undefined, '/2025');
    expect(read.headers.get('Cache-Control')).toBe('private, no-store');
    const saved = (await read.json()) as { archive: HistoricalBid; sha256: string };
    expect(saved.archive).toEqual(fixture());
    expect(saved.sha256).toBe(receipt.sha256);
    expect(await (await request()).json()).toEqual({ years: [2025] });
    expect(createHash('sha256').update(new Uint8Array(h.sqlite.serialize())).digest('hex')).toBe(
      before,
    );
    expect(objects.size).toBe(1);
  });
  it('is idempotent for exact retries and refuses replacement', async () => {
    expect((await request('POST', fixture())).status).toBe(201);
    const original = objects.get('historical-bids/v1/2025.json');
    const retry = await request('POST', fixture());
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ alreadyPublished: true });
    expect((await request('POST', { ...fixture(), label: 'Changed document' })).status).toBe(409);
    expect(objects.get('historical-bids/v1/2025.json')).toBe(original);
  });
  it('rejects current/future years, oversized uploads and malformed sources', async () => {
    expect(
      (await request('POST', { ...fixture(), year: new Date().getUTCFullYear() })).status,
    ).toBe(409);
    expect((await request('POST', { ...fixture(), year: 9999 })).status).toBe(409);
    expect(
      (await request('POST', { ...fixture(), seats: [fixture().seats[0], fixture().seats[0]] }))
        .status,
    ).toBe(400);
    expect((await request('POST', 'x'.repeat(1_048_577))).status).toBe(413);
    expect((await request('GET', undefined, '/invalid')).status).toBe(400);
    expect((await request('GET', undefined, '/2025')).status).toBe(404);
    expect(objects.size).toBe(0);
  });
  it('rejects inferred identity links, unknown sources and undocumented D supplements', () => {
    for (const patch of [
      { memberId: 101 },
      { sourceId: 'unknown' },
      { shift: 'B' },
      { name: null },
      { status: 'WITHDRAWN' },
      { status: 'OFFICIAL_POSITION_SUPPLEMENT' },
    ]) {
      expect(
        HistoricalBidSchema.safeParse({
          ...fixture(),
          seats: [{ ...fixture().seats[0], ...patch }],
        }).success,
      ).toBe(false);
    }
  });
  it('includes official current Days posts while excluding historical employees by ID and temporary locations', async () => {
    const archive = fixture();
    const firstSeat = archive.seats[0];
    if (!firstSeat) throw new Error('Synthetic award missing');
    firstSeat.employeeReference = {
      employeeId: '1001',
      sourceId: 'synthetic',
      sourceLocation: 'Synthetic ID column',
    };
    expect((await request('POST', archive)).status).toBe(201);
    h.sqlite.exec(`
      INSERT INTO members(id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at)
        VALUES (1001, '1001', 'Renamed', 'Historical Person', 'LT', 'OFC', 1, 1, 1),
               (1002, '1002', 'Synthetic historical', 'winner', 'LT', 'OFC', 2, 1, 1);
      INSERT INTO staffing_positions(id, stable_slot_key, shift, station, unit, position_name, review_status, active_from, created_at, updated_at)
        VALUES ('historical-person', 'historical-person', 'D', 'Rescue', 'Administration', 'Chief', 'approved', '2020-01-01', 1, 1),
               ('same-name', 'same-name', 'D', 'Prevention', 'Administration', 'Captain', 'approved', '2020-01-01', 1, 1),
               ('vacant', 'vacant', 'D', 'Support Services', 'Administration', 'Coordinator', 'approved', '2020-01-01', 1, 1),
               ('light-duty', 'light-duty', 'D', 'Light Duty', 'PSCD', 'Lieutenant', 'approved', '2020-01-01', 1, 1),
               ('special', 'special', 'D', 'Chief Office', 'Special Assignments', 'Firefighter', 'approved', '2020-01-01', 1, 1),
               ('draft', 'draft', 'D', 'Prevention', 'Administration', 'Captain', 'draft', '2020-01-01', 1, 1);
      INSERT INTO member_assignments(id, member_id, staffing_position_id, origin_type, origin_ref, status, effective_from, created_at, updated_at)
        VALUES ('h-assignment',1001,'historical-person','ADMIN_TRANSFER','synthetic','active','2020-01-01',1,1),
               ('s-assignment',1002,'same-name','ADMIN_TRANSFER','synthetic','active','2020-01-01',1,1);
    `);
    const before = createHash('sha256').update(new Uint8Array(h.sqlite.serialize())).digest('hex');
    const response = await request('GET', undefined, '/2025/days-supplement');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { positions: { id: string }[] };
    expect(body.positions.map((position) => position.id).sort()).toEqual(['same-name', 'vacant']);
    expect(createHash('sha256').update(new Uint8Array(h.sqlite.serialize())).digest('hex')).toBe(
      before,
    );
  });
  it('does not guess Days exclusions when historical employee identifiers are unavailable', async () => {
    await request('POST', fixture());
    expect((await request('GET', undefined, '/2025/days-supplement')).status).toBe(409);
  });
  it('rejects damaged stored history and concurrent replacement', async () => {
    const [first, second] = await Promise.all([
      request('POST', fixture()),
      request('POST', { ...fixture(), label: 'Concurrent alternative' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const key = 'historical-bids/v1/2025.json';
    const damaged = JSON.parse(objects.get(key) ?? 'null');
    damaged.archive.label = 'Unexpected storage mutation';
    objects.set(key, JSON.stringify(damaged));
    expect((await request('GET', undefined, '/2025')).status).toBe(409);
    expect((await request('GET', undefined, '/2025/days-supplement')).status).toBe(409);
    expect((await request('POST', fixture())).status).toBe(409);
  });
});
