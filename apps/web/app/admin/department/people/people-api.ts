import type { CatalogCredential } from '../../credentials/CredentialsCatalogWorkspace';

export async function readDepartment<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || body === null) {
    throw new Error(
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error.replaceAll('_', ' ')
        : `Department data could not be loaded (${response.status}).`,
    );
  }
  return body as T;
}

/** Read every catalog page; a missing page is an error, never a silent cap. */
export async function readCredentialCatalog(signal?: AbortSignal): Promise<CatalogCredential[]> {
  const rows: CatalogCredential[] = [];
  let total = 1;
  while (rows.length < total) {
    const page = await readDepartment<{ credentials: CatalogCredential[]; total: number }>(
      `/api/admin/credentials?limit=500&offset=${rows.length}`,
      signal,
    );
    if (
      !Number.isSafeInteger(page.total) ||
      page.total < 0 ||
      !Array.isArray(page.credentials) ||
      (!page.credentials.length && rows.length < page.total)
    ) {
      throw new Error('The credential catalog returned an incomplete page.');
    }
    total = page.total;
    rows.push(...page.credentials);
  }
  return rows;
}
