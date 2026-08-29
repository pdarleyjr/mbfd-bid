import { cfEnv } from '@/lib/cf-env';
import { JWT_COOKIE_NAME } from '@/lib/cookies';
import { requireAdmin } from '@/lib/require-admin';
import { csrfFailureForUnsafeRequest } from '@/lib/server-csrf';
import { getWorkerBase } from '@/lib/worker-base';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const csrfFailure = await csrfFailureForUnsafeRequest(req, cfEnv('ENV'));
  if (csrfFailure !== null) {
    return NextResponse.json({ error: `csrf_${csrfFailure}_forbidden` }, { status: 403 });
  }

  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const store = await cookies();
  const jwt = store.get(JWT_COOKIE_NAME)?.value;
  if (!jwt) {
    return NextResponse.json({ error: 'Missing session.' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Uploaded file is empty.' }, { status: 400 });
  }

  const mode = (formData.get('mode') as string | null) ?? 'normalized';
  if (mode !== 'normalized' && mode !== 'legacy_wide_matrix') {
    return NextResponse.json({ error: `Invalid mode: ${mode}` }, { status: 400 });
  }

  const metadataColumnsRaw = formData.get('metadata_columns');
  const metadataColumns = metadataColumnsRaw ? Number(metadataColumnsRaw) : 4;
  if (!Number.isInteger(metadataColumns) || metadataColumns < 0) {
    return NextResponse.json(
      { error: `Invalid metadata_columns value: ${metadataColumnsRaw}` },
      { status: 400 },
    );
  }

  const body = new FormData();
  body.append('file', file);

  const workerUrl = getWorkerBase();
  const url = new URL(`${workerUrl}/api/admin/credentials/import`);
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
    return NextResponse.json({ error: `Failed to reach worker: ${message}` }, { status: 502 });
  }

  if (!res.ok) {
    if (res.headers.get('content-type')?.includes('application/json')) {
      return new Response(res.body, {
        status: res.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    const text = await res.text().catch(() => '');
    return NextResponse.json(
      { error: `Worker returned ${res.status}: ${text}` },
      { status: res.status },
    );
  }

  const result = await res.json();
  return NextResponse.json(result);
}
