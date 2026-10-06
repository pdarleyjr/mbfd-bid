import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { PortalPayloadV2 } from '@mbfd/shared';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PostResult } from '../../src/portal-writeback/portal-client.js';

// Use the already pinned runtime, without adding/migrating test dependencies.
// Vitest4/Miniflare5 removed createFetchMock; outboundService keeps Workerd's
// native global fetch intact and replaces only its network destination.
interface Runtime {
  dispatchFetch(url: string, init: RequestInit): Promise<Response>;
  dispose(): Promise<void>;
}
const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = runtimeRequire('miniflare') as {
  Miniflare: new (options: unknown) => Runtime;
  convertV4MiniflareOptions: (options: {
    modules: boolean;
    script: string;
    compatibilityDate: string;
    compatibilityFlags: string[];
    outboundService: (request: Request) => Promise<Response>;
  }) => unknown;
};
const origin = 'https://synthetic-portal.invalid';
const credential = 'synthetic-writer-credential';

function payload(employee: string): PortalPayloadV2 {
  return {
    payload_version: 2,
    bid_year: 2026,
    term_label: '2026–2027',
    bid_session_id: 'synthetic-native-fetch',
    employee_id: employee,
    rank_label: 'Firefighter',
    station_label: 'Station #1',
    shift_label: 'A Shift',
    division_label: 'Combat',
    unit_label: 'Combat 1',
    position_id: 'A101',
    position_label: 'Firefighter #1',
    bid_selection_label: 'Combat 1',
    assignment_type: 'Assigned',
    assignment_source: 'bid_award',
    a_day_code: 'G3',
    a_day_label: 'Group 3',
    picked_at: '2026-01-01T00:00:00Z',
    idempotency_key: `synthetic-${employee}`,
    is_forced: false,
    admin_actor_employee_id: null,
    source_sequence: 1,
    source_result_hash: 'a'.repeat(64),
    source_workbook_sha256: 'b'.repeat(64),
  };
}

describe('Portal client with the native Workerd fetch receiver', () => {
  let runtime: Runtime;
  let requests: string[];
  beforeAll(() => {
    requests = [];
    const client = ts.transpileModule(
      readFileSync(new URL('../../src/portal-writeback/portal-client.ts', import.meta.url), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        compatibilityDate: '2024-11-01',
        compatibilityFlags: ['nodejs_compat'],
        script: `${client}
export default { async fetch(request) {
  const args = await request.json();
  return Response.json(await postBidAssignment({ ...args, fetchImpl: globalThis.fetch }));
} };`,
        outboundService: async (request) => {
          const url = new URL(request.url);
          const body = (await request.json()) as PortalPayloadV2;
          // Closed mock boundary: there is no network fallback or real credential.
          if (
            url.origin !== origin ||
            request.method !== 'POST' ||
            url.pathname !== `/api/v2/members/${body.employee_id}/bid-assignment` ||
            request.headers.get('Authorization') !== `Bearer ${credential}` ||
            request.headers.get('Content-Type') !== 'application/json' ||
            JSON.stringify(body) !== JSON.stringify(payload(body.employee_id))
          )
            throw new Error('Unexpected synthetic outbound request; network is disabled');
          requests.push(body.employee_id);
          if (body.employee_id === 'synthetic-duplicate')
            return Response.json({ code: 'already_recorded' }, { status: 409 });
          if (body.employee_id === 'synthetic-conflict')
            return Response.json({ code: 'payload_conflict' }, { status: 409 });
          if (body.employee_id === 'synthetic-unavailable')
            return new Response('synthetic unavailable', { status: 503 });
          if (body.employee_id === 'synthetic-redirect')
            return new Response(null, {
              status: 302,
              headers: { Location: 'https://unexpected.invalid' },
            });
          return Response.json({ status: 'accepted' });
        },
      }),
    );
  });
  afterAll(async () => runtime?.dispose());

  async function publish(employee: string, enabled = true): Promise<PostResult> {
    const response = await runtime.dispatchFetch('http://localhost/test', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: employee,
        payload: payload(employee),
        portalBaseUrl: origin,
        publicationEnabled: enabled,
        token: credential,
      }),
    });
    return (await response.json()) as PostResult;
  }

  it('reaches the host mock and sends the exact V2 payload through native fetch', async () => {
    expect(await publish('synthetic-success')).toEqual({ kind: 'synced', statusCode: 200 });
    expect(requests).toContain('synthetic-success');
  });

  it('accepts an exact duplicate receipt without treating another conflict as success', async () => {
    expect(await publish('synthetic-duplicate')).toEqual({ kind: 'synced', statusCode: 409 });
    expect(await publish('synthetic-conflict')).toMatchObject({
      kind: 'permanent',
      statusCode: 409,
    });
  });

  it('classifies an actual mocked HTTP503 as transient', async () => {
    expect(await publish('synthetic-unavailable')).toEqual({
      kind: 'transient',
      statusCode: 503,
      message: 'synthetic unavailable',
    });
  });

  it('leaves the native network boundary untouched while publication is disabled', async () => {
    const count = requests.length;
    expect(await publish('synthetic-disabled', false)).toMatchObject({
      kind: 'permanent',
      statusCode: 0,
    });
    expect(requests).toHaveLength(count);
  });

  it('rejects a native redirect without forwarding credentials to its destination', async () => {
    const count = requests.length;
    expect(await publish('synthetic-redirect')).toEqual({
      kind: 'permanent',
      statusCode: 302,
      message: 'Portal redirect is not permitted',
    });
    expect(requests.slice(count)).toEqual(['synthetic-redirect']);
  });
});
