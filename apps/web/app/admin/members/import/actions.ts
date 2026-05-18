'use server';

import { JWT_COOKIE_NAME } from '@/lib/cookies';
import { requireAdmin } from '@/lib/require-admin';
import { cookies } from 'next/headers';

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';

export type ImportError = {
  rowNumber: number;
  raw: unknown;
  message: string;
};

export type ImportResult =
  | {
      inserted: number;
      updated: number;
      errors: ImportError[];
    }
  | { error: string };

export async function uploadMembersCsv(formData: FormData): Promise<ImportResult> {
  await requireAdmin();

  const file = formData.get('file');
  if (!(file instanceof File)) return { error: 'No file uploaded.' };
  if (file.size === 0) return { error: 'Uploaded file is empty.' };

  const store = await cookies();
  const jwt = store.get(JWT_COOKIE_NAME)?.value;
  if (!jwt) return { error: 'Missing session.' };

  const body = new FormData();
  body.append('file', file);

  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/api/admin/members/import`, {
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
