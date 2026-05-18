'use server';

import type { ImportResult } from '@/app/admin/members/import/actions';
import { JWT_COOKIE_NAME } from '@/lib/cookies';
import { requireAdmin } from '@/lib/require-admin';
import { cookies } from 'next/headers';

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';

export type { ImportResult };

export async function uploadCredentialsXlsx(formData: FormData): Promise<ImportResult> {
  await requireAdmin();

  const file = formData.get('file');
  if (!(file instanceof File)) return { error: 'No file uploaded.' };
  if (file.size === 0) return { error: 'Uploaded file is empty.' };

  const mode = (formData.get('mode') as string | null) ?? 'normalized';
  if (mode !== 'normalized' && mode !== 'legacy_wide_matrix') {
    return { error: `Invalid mode: ${mode}` };
  }

  const metadataColumnsRaw = formData.get('metadata_columns');
  const metadataColumns = metadataColumnsRaw ? Number(metadataColumnsRaw) : 4;
  if (!Number.isInteger(metadataColumns) || metadataColumns < 0) {
    return { error: `Invalid metadata_columns value: ${metadataColumnsRaw}` };
  }

  const store = await cookies();
  const jwt = store.get(JWT_COOKIE_NAME)?.value;
  if (!jwt) return { error: 'Missing session.' };

  const body = new FormData();
  body.append('file', file);

  const url = new URL(`${WORKER_URL}/api/admin/credentials/import`);
  url.searchParams.set('mode', mode);
  if (mode === 'legacy_wide_matrix') {
    url.searchParams.set('metadata_columns', String(metadataColumns));
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Failed to reach worker: ${message}` };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `Worker returned ${res.status}: ${text}` };
  }

  return (await res.json()) as ImportResult;
}
