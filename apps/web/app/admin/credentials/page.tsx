import { requireAdmin } from '@/lib/require-admin';
import { getServerRpc } from '@/lib/rpc-server';

interface Credential {
  id: number;
  name: string;
  fyPointsDefault: number;
}

interface CredentialsResponse {
  credentials: Credential[];
  total: number;
}

export default async function AdminCredentialsPage() {
  await requireAdmin();

  const client = await getServerRpc();

  let credentials: Credential[] = [];
  let total = 0;
  let fetchError: string | null = null;

  try {
    // biome-ignore lint/suspicious/noExplicitAny: WorkerClient is typed as any — see rpc-client.ts
    const res = await (client as any).api.admin.credentials.$get({
      query: { limit: '200', offset: '0' },
    });
    if (res.ok) {
      const data = (await res.json()) as CredentialsResponse;
      credentials = data.credentials;
      total = data.total;
    } else {
      fetchError = `API error: ${res.status}`;
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Failed to fetch credentials';
  }

  return (
    <div>
      <h1 className="font-heading text-2xl text-white">Credentials</h1>
      {fetchError ? (
        <p className="mt-1 text-sm text-red-400">{fetchError}</p>
      ) : (
        <p className="mt-1 text-sm text-slate-400">
          {total} credential type{total !== 1 ? 's' : ''} on record
        </p>
      )}

      {fetchError ? (
        <p className="mt-6 rounded-xl border border-red-700/40 bg-red-900/20 px-4 py-6 text-center text-slate-300">
          Could not load credentials. Check worker connectivity.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800">
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400"
                >
                  ID
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400"
                >
                  Name
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400"
                >
                  FY Points Default
                </th>
              </tr>
            </thead>
            <tbody>
              {credentials.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-500">
                    No credentials on record.
                  </td>
                </tr>
              ) : (
                credentials.map((cred, idx) => (
                  <tr
                    key={cred.id}
                    className={[
                      'border-b border-slate-700',
                      idx % 2 === 0 ? 'bg-slate-850' : 'bg-slate-800',
                    ].join(' ')}
                  >
                    <td className="px-4 py-2 font-mono text-xs text-slate-500 [font-variant-numeric:tabular-nums]">
                      {cred.id}
                    </td>
                    <td className="px-4 py-2 text-slate-200">{cred.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-400 [font-variant-numeric:tabular-nums]">
                      {cred.fyPointsDefault}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
