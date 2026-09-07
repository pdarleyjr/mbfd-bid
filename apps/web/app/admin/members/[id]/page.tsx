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
  qualifications?: Array<{
    credentialId: number;
    name: string;
    status: string;
    expiresOn: string | null;
  }>;
}

const RANK_LABELS: Record<string, string> = {
  FF: 'Firefighter',
  LT: 'Lieutenant',
  CPT: 'Captain',
  DC: 'Division Chief',
  DEP_CHIEF: 'Deputy Fire Chief',
  CHIEF: 'Fire Chief',
  CIVILIAN: 'Civilian / no fire rank',
};

function ProfileField({
  label,
  value,
  mono = false,
}: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={[
          'mt-1 text-base font-semibold text-foreground',
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
  let memberCredentials: Array<{
    credentialId: number;
    name: string;
    status: string;
    expiresOn: string | null;
  }> = [];

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
    memberCredentials = data.qualifications ?? [];
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
        <Link
          href={'/admin/members' as const}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Members
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm text-foreground">
          {member.lastName}, {member.firstName}
        </span>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Link
            href={`/admin/personnel/qualifications?memberId=${member.id}` as Route}
            className="rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:border-border"
          >
            Review qualification lifecycle
          </Link>
          <Link
            href={`/admin/personnel?memberId=${member.id}` as Route}
            className="rounded bg-destructive px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-destructive"
          >
            Personnel change
          </Link>
        </div>
      </div>

      <h1 className="font-heading text-2xl text-foreground">
        {member.lastName}, {member.firstName}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {RANK_LABELS[member.rank] ?? member.rank} &bull; {member.bidCategory}
        {member.isProbationary && (
          <span className="ml-2 inline-flex rounded bg-destructive-surface px-2 py-0.5 text-xs font-medium text-destructive">
            Probationary
          </span>
        )}
      </p>

      <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ProfileField label="Employee ID" value={member.employeeId} mono />
        <ProfileField label="Member ID" value={String(member.id)} mono />
        <ProfileField label="Rank" value={RANK_LABELS[member.rank] ?? member.rank} />
        <ProfileField label="Bid Category" value={member.bidCategory} />
        <ProfileField
          label="RSC Seniority"
          value={member.bidCategory === 'EXCLUDED' ? 'Not applicable' : String(member.rscSeniority)}
          mono
        />
        {member.rankSeniority !== null && (
          <ProfileField label="Rank Seniority" value={String(member.rankSeniority)} mono />
        )}
        <ProfileField label="Hired" value={member.hiredAt ?? '—'} mono />
        {member.promotedAt && <ProfileField label="Promoted" value={member.promotedAt} mono />}
      </dl>

      <section className="mt-8">
        <h2 className="font-heading text-lg text-foreground">Current qualifications</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Status reflects the current dated record. Open Update qualifications to inspect the
          evidence, renew a certificate or correct a date. Approved bid results remain preserved.
        </p>
        {memberCredentials.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No current qualification records are available. Review the member’s history or import
            credentials.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {memberCredentials.map((cred) => (
              <li
                key={cred.credentialId}
                className="rounded bg-card px-2 py-1 text-sm text-foreground"
              >
                {cred.name} · {cred.status} · Expiration: {cred.expiresOn ?? 'not recorded'}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
