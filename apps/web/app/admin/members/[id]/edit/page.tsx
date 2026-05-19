import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { cfEnv } from '../../../../../lib/cf-env';
import { JWT_COOKIE_NAME } from '../../../../../lib/cookies';
import { requireAdmin } from '../../../../../lib/require-admin';
import { EditForm } from './EditForm';

export const runtime = 'edge';

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
  const cookieStore = await cookies();
  const jwt = cookieStore.get(JWT_COOKIE_NAME)?.value;
  const baseUrl = cfEnv('WORKER_URL') ?? 'http://localhost:8787';
  const res = await fetch(`${baseUrl}/api/admin/members/${id}`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
    cache: 'no-store',
  });
  if (res.status === 404) notFound();
  const { member } = (await res.json()) as MemberResponse;

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
