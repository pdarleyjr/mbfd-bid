import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../../lib/require-admin';
import { serverWorkerFetch } from '../../../../../lib/server-worker-fetch';
import { EditForm } from './EditForm';

export const dynamic = 'force-dynamic';

interface MemberResponse {
  member: {
    id: number;
    employeeId: string;
    firstName: string;
    lastName: string;
    rank: 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF';
    bidCategory: 'OFC' | 'FF' | 'EXCLUDED';
    rscSeniority: number;
    isProbationary: boolean;
  };
}

export default async function MemberEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  let member: MemberResponse['member'] | null = null;
  let fetchError: string | null = null;
  try {
    const res = await serverWorkerFetch(`/api/admin/members/${id}`);
    if (res.status === 404) notFound();
    if (!res.ok) {
      fetchError = `Worker returned ${res.status}`;
    } else {
      const body = (await res.json()) as { member?: MemberResponse['member'] };
      member = body.member ?? null;
      if (member === null) fetchError = 'Worker response missing member';
    }
  } catch (e) {
    fetchError = e instanceof Error ? e.message : 'fetch failed';
  }

  if (member === null) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="font-heading text-2xl text-white">Edit member</h1>
        <div className="mt-6 rounded-lg border border-amber-600 bg-amber-950/30 p-4 text-sm text-amber-200">
          Could not load member #{id}: {fetchError ?? 'unknown error'}.{' '}
          <span className="text-amber-300">
            Check the Worker logs and JWT validity, then reload this page.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-heading text-2xl text-white">
        Edit member {member.firstName} {member.lastName}
      </h1>
      <p className="mt-1 text-sm text-slate-300">
        Employee ID: {member.employeeId} - Member ID #{member.id}
      </p>
      <EditForm member={member} />
    </div>
  );
}
