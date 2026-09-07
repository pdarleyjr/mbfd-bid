import { requireAdmin } from '@/lib/require-admin';
import { getServerRpc } from '@/lib/rpc-server';
import { type CatalogCredential, CredentialsCatalogWorkspace } from './CredentialsCatalogWorkspace';

interface CredentialsResponse {
  credentials: CatalogCredential[];
  total: number;
}

export default async function AdminCredentialsPage() {
  await requireAdmin();

  const client = await getServerRpc();

  const credentials: CatalogCredential[] = [];
  let fetchError: string | null = null;

  try {
    let total = 1;
    while (credentials.length < total) {
      // biome-ignore lint/suspicious/noExplicitAny: WorkerClient is typed as any — see rpc-client.ts
      const res = await (client as any).api.admin.credentials.$get({
        query: { limit: '500', offset: String(credentials.length) },
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = (await res.json()) as CredentialsResponse;
      total = data.total;
      if (
        !Number.isSafeInteger(total) ||
        total < 0 ||
        (!data.credentials.length && credentials.length < total)
      )
        throw new Error('Incomplete credential catalog response');
      credentials.push(...data.credentials);
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Failed to fetch credentials';
  }

  if (fetchError !== null) {
    return (
      <p className="rounded-xl border border-destructive/40 bg-destructive-surface px-4 py-6 text-center text-foreground">
        Could not load credentials: {fetchError}
      </p>
    );
  }
  return <CredentialsCatalogWorkspace initialCredentials={credentials} />;
}
