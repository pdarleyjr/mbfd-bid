import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('@/lib/require-admin', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/rpc-server', () => ({
  getServerRpc: async () => ({ api: { admin: { credentials: { $get: mocks.get } } } }),
}));
import AdminCredentialsPage from '../../app/admin/credentials/page';
beforeEach(() => vi.clearAllMocks());
async function html(client = new QueryClient()) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>{await AdminCredentialsPage()}</QueryClientProvider>,
  );
}
describe('complete initial credential catalog', () => {
  it('loads subsequent pages before priming the shared fresh catalog cache', async () => {
    const credential = (id: number) => ({
      id,
      name: `Synthetic credential ${id}`,
      fyPointsDefault: 0,
      holderCount: 0,
    });
    mocks.get
      .mockResolvedValueOnce(
        Response.json({
          credentials: Array.from({ length: 500 }, (_, i) => credential(i + 1)),
          total: 501,
        }),
      )
      .mockResolvedValueOnce(Response.json({ credentials: [credential(501)], total: 501 }));
    const client = new QueryClient();
    expect(await html(client)).toContain('1–8 of 501 credentials');
    expect(client.getQueryData(['admin', 'credentials'])).toHaveLength(501);
    expect((client.getQueryData(['admin', 'credentials']) as { name: string }[]).at(-1)?.name).toBe(
      'Synthetic credential 501',
    );
    expect(mocks.get).toHaveBeenNthCalledWith(2, { query: { limit: '500', offset: '500' } });
  });
  it('does not present a truncated catalog as complete after a missing page', async () => {
    mocks.get
      .mockResolvedValueOnce(
        Response.json({
          credentials: [{ id: 1, name: 'Partial catalog', fyPointsDefault: 0, holderCount: 0 }],
          total: 2,
        }),
      )
      .mockResolvedValueOnce(Response.json({ credentials: [], total: 2 }));
    const rendered = await html();
    expect(rendered).toContain('Could not load credentials');
    expect(rendered).not.toContain('Add credential');
  });
});
