import { requireAdmin } from '@/lib/require-admin';
import { getServerRpc } from '@/lib/rpc-server';
import { type CatalogCredential, CredentialsCatalogWorkspace } from './CredentialsCatalogWorkspace';

interface CredentialsResponse {
  credentials: CatalogCredential[];
}

export default async function AdminCredentialsPage() {
  await requireAdmin();

  const client = await getServerRpc();

  let credentials: CatalogCredential[] = [];
  let fetchError: string | null = null;

  try {
    // biome-ignore lint/suspicious/noExplicitAny: WorkerClient is typed as any — see rpc-client.ts
    const res = await (client as any).api.admin.credentials.$get({
      query: { limit: '200', offset: '0' },
    });
    if (res.ok) {
      const data = (await res.json()) as CredentialsResponse;
      credentials = data.credentials;
    } else {
      fetchError = `API error: ${res.status}`;
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Failed to fetch credentials';
  }

  if (fetchError !== null) {
    return (
      <p className="rounded-xl border border-red-700/40 bg-red-900/20 px-4 py-6 text-center text-slate-300">
        Could not load credentials: {fetchError}
      </p>
    );
  }
  return <CredentialsCatalogWorkspace initialCredentials={credentials} />;
}
