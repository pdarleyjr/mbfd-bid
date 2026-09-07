import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  serverWorkerFetch: vi.fn(),
}));

vi.mock('@/lib/require-admin', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/server-worker-fetch', () => ({ serverWorkerFetch: mocks.serverWorkerFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AdminQueryProvider } from '../../app/admin/_components/AdminQueryProvider';
import PersonnelPage from '../../app/admin/personnel/page';

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const members = Array.from({ length: 262 }, (_, index) => ({
  id: index + 1,
  employeeId: String(10_000 + index),
  firstName: index === 261 ? 'Tail' : `Member${index + 1}`,
  lastName: index === 261 ? 'Member' : `Roster${String(index + 1).padStart(3, '0')}`,
  rank: 'FF' as const,
  employmentStatus: 'unknown' as const,
  employmentStatusEffectiveOn: null,
  separationType: null,
}));

beforeEach(() => {
  mocks.requireAdmin.mockReset();
  mocks.requireAdmin.mockResolvedValue({ role: 'admin', sub: 1 });
  mocks.serverWorkerFetch.mockReset();
  mocks.serverWorkerFetch.mockImplementation(async (path: string) => {
    if (path === '/api/admin/personnel/summary') {
      return response({
        asOf: '2026-09-05',
        members: { active: 33, inactive: 0, retired: 0, separated: 0, unclassified: 229 },
        activeAssignments: 262,
        upcomingChanges: 0,
      });
    }
    if (path === '/api/admin/personnel/members?limit=250') {
      return response({ members: members.slice(0, 250) });
    }
    if (path === '/api/admin/personnel/members?limit=500') {
      return response({ members });
    }
    throw new Error(`Unexpected worker path: ${path}`);
  });
});

describe('PersonnelPage', () => {
  it('loads the complete supported roster so every member can use the audited lifecycle form', async () => {
    const html = renderToStaticMarkup(
      <AdminQueryProvider>
        {await PersonnelPage({ searchParams: Promise.resolve({ memberId: '262' }) })}
      </AdminQueryProvider>,
    );

    expect(mocks.serverWorkerFetch).toHaveBeenCalledWith('/api/admin/personnel/members?limit=500');
    expect(html).toContain('Member, Tail');
    expect(html).toContain('<option value="262" selected="">');
  });
});
