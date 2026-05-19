import { JWT_COOKIE_NAME } from '@/lib/cookies';
import { requireAdmin } from '@/lib/require-admin';
import { getWorkerBase } from '@/lib/worker-base';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: Request) {
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

  const body = new FormData();
  body.append('file', file);

  const workerUrl = getWorkerBase();
  let res: Response;
  try {
    res = await fetch(`${workerUrl}/api/admin/members/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to reach worker: ${message}` }, { status: 502 });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return NextResponse.json(
      { error: `Worker returned ${res.status}: ${text}` },
      { status: res.status },
    );
  }

  const result = await res.json();
  return NextResponse.json(result);
}
