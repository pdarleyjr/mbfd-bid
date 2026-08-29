import { requireAdmin } from '@/lib/require-admin';
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(
    {
      error: 'legacy_member_write_retired',
      operation: 'member_import',
      message: 'Legacy member uploads are retired and do not accept files.',
      operator_workflows: {
        telestaff: '/admin/telestaff',
        personnel: '/admin/personnel',
      },
    },
    { status: 410 },
  );
}
