import { requireAdmin } from '@/lib/require-admin';
import { getServerRpc } from '@/lib/rpc-server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

interface MemberRow {
  id: number;
  employee_id: string;
  first_name: string;
  last_name: string;
  rank: string;
  bid_category: string;
  rsc_seniority: number;
  rank_seniority: number | null;
  hired_at: string | null;
  promoted_at: string | null;
  is_probationary: boolean;
  created_at: string | null;
  updated_at: string | null;
}

interface MemberDetailResponse {
  member: MemberRow;
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
  const client = await getServerRpc();

  let member: MemberRow | null = null;

  try {
    // biome-ignore lint/suspicious/noExplicitAny: WorkerClient is typed as any — see rpc-client.ts
    const res = await (client as any).api.admin.members[':id{\\d+}'].$get({
      param: { 'id{\\d+}': id },
    });

    if (res.status === 404) {
      notFound();
    }

    if (res.ok) {
      const data = (await res.json()) as MemberDetailResponse;
      member = data.member;
    }
  } catch {
    notFound();
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
          {member.last_name}, {member.first_name}
        </span>
      </div>

      <h1 className="font-heading text-2xl text-white">
        {member.last_name}, {member.first_name}
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        {RANK_LABELS[member.rank] ?? member.rank} &bull; {member.bid_category}
        {member.is_probationary && (
          <span className="ml-2 inline-flex rounded bg-red-900/40 px-2 py-0.5 text-xs font-medium text-red-300">
            Probationary
          </span>
        )}
      </p>

      <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ProfileField label="Employee ID" value={member.employee_id} mono />
        <ProfileField label="Member ID" value={String(member.id)} mono />
        <ProfileField label="Rank" value={RANK_LABELS[member.rank] ?? member.rank} />
        <ProfileField label="Bid Category" value={member.bid_category} />
        <ProfileField label="RSC Seniority" value={String(member.rsc_seniority)} mono />
        {member.rank_seniority !== null && (
          <ProfileField label="Rank Seniority" value={String(member.rank_seniority)} mono />
        )}
        <ProfileField label="Hired" value={member.hired_at ?? '—'} mono />
        {member.promoted_at && <ProfileField label="Promoted" value={member.promoted_at} mono />}
      </dl>

      <section className="mt-8">
        <h2 className="font-heading text-lg text-white">Credentials</h2>
        <p className="mt-3 text-sm text-slate-400">No credentials on file.</p>
      </section>
    </div>
  );
}
