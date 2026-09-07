import { MembersTable } from '@/components/admin/MembersTable';
import { requireAdmin } from '@/lib/require-admin';
import { getServerRpc } from '@/lib/rpc-server';
import Link from 'next/link';

interface MemberRow {
  id: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  rank: string;
  bidCategory: string;
  rscSeniority: number;
  hiredAt: string | null;
  isProbationary: boolean;
}

interface MembersResponse {
  members: MemberRow[];
  total: number;
}

export default async function AdminMembersPage() {
  await requireAdmin();

  const client = await getServerRpc();

  let members: MemberRow[] = [];
  let total = 0;
  let fetchError: string | null = null;

  try {
    // biome-ignore lint/suspicious/noExplicitAny: WorkerClient is typed as any — see rpc-client.ts
    const res = await (client as any).api.admin.members.$get({
      query: { limit: '100', offset: '0' },
    });
    if (res.ok) {
      const data = (await res.json()) as MembersResponse;
      members = data.members;
      total = data.total;
    } else {
      fetchError = `API error: ${res.status}`;
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Failed to fetch members';
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-foreground">Members</h1>
          {fetchError ? (
            <p className="mt-1 text-sm text-destructive">{fetchError}</p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {total} member{total !== 1 ? 's' : ''} on record
            </p>
          )}
        </div>
        <Link
          href={'/admin/telestaff' as const}
          className="flex min-h-[44px] items-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-primary-foreground transition-colors duration-fast ease-out-quart hover:bg-destructive"
        >
          TeleStaff reconciliation
        </Link>
      </div>

      <div className="mt-6">
        {fetchError ? (
          <p className="rounded-xl border border-destructive/40 bg-destructive-surface px-4 py-6 text-center text-foreground">
            Could not load members. Check worker connectivity.
          </p>
        ) : (
          <MembersTable members={members} />
        )}
      </div>
    </div>
  );
}
