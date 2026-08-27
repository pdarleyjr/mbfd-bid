import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import type { Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface MemberRow {
  id: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  rank: string;
  bidCategory: string;
  rscSeniority: number;
  rankSeniority: number | null;
  hiredAt: string | null;
  promotedAt: string | null;
  isProbationary: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface MemberDetailResponse {
  member: MemberRow;
  credentials?: Array<{ id: number; name: string }>;
}

const RANK_LABELS: Record<string, string> = {
  FF: 'Firefighter',
  LT: 'Lieutenant',
  CPT: 'Captain',
  DC: 'Division Chief',
  DEP_CHIEF: 'Deputy Fire Chief',
  CHIEF: 'Fire Chief',
};

function ProfileField({
  label,
  value,
  mono = false,
}: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd
        className={[
          'mt-1 text-base font-semibold text-white',
          mono ? 'font-mono [font-variant-numeric:tabular-nums]' : '',
        ].join(' ')}
      >
        {value || '—'}
      </dd>
    </div>
  );
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  let member: MemberRow | null = null;
  let memberCredentials: Array<{ id: number; name: string }> = [];

  try {
    const res = await serverWorkerFetch(`/api/admin/members/${id}`);

    if (res.status === 404) {
      notFound();
    }

    if (!res.ok) {
      throw new Error(`Member fetch failed: ${res.status}`);
    }

    const data = (await res.json()) as MemberDetailResponse;
    member = data.member;
    memberCredentials = data.credentials ?? [];
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error('Member fetch failed');
  }

  if (!member) {
    notFound();
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link href={'/admin/members' as const} className="text-sm text-slate-400 hover:text-white">
          Members
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-sm text-slate-200">
          {member.lastName}, {member.firstName}
        </span>
        <Link
          href={`/admin/members/${member.id}/edit` as Route}
          className="ml-auto rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600"
        >
          Edit
        </Link>
      </div>

      <h1 className="font-heading text-2xl text-white">
        {member.lastName}, {member.firstName}
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        {RANK_LABELS[member.rank] ?? member.rank} &bull; {member.bidCategory}
        {member.isProbationary && (
          <span className="ml-2 inline-flex rounded bg-red-900/40 px-2 py-0.5 text-xs font-medium text-red-300">
            Probationary
          </span>
        )}
      </p>

      <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ProfileField label="Employee ID" value={member.employeeId} mono />
        <ProfileField label="Member ID" value={String(member.id)} mono />
        <ProfileField label="Rank" value={RANK_LABELS[member.rank] ?? member.rank} />
        <ProfileField label="Bid Category" value={member.bidCategory} />
        <ProfileField label="RSC Seniority" value={String(member.rscSeniority)} mono />
        {member.rankSeniority !== null && (
          <ProfileField label="Rank Seniority" value={String(member.rankSeniority)} mono />
        )}
        <ProfileField label="Hired" value={member.hiredAt ?? '—'} mono />
        {member.promotedAt && <ProfileField label="Promoted" value={member.promotedAt} mono />}
      </dl>

      <section className="mt-8">
        <h2 className="font-heading text-lg text-white">Credentials</h2>
        {memberCredentials.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No credentials on file.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {memberCredentials.map((cred) => (
              <li key={cred.id} className="rounded bg-slate-800 px-2 py-1 text-sm text-slate-200">
                {cred.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
