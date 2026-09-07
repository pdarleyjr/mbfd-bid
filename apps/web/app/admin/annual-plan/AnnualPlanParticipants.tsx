'use client';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';
import { type AnnualPlan, annualGet, buttonClass, fieldClass } from './annual-plan-client';
type Member = {
  memberId: number;
  firstName: string;
  lastName: string;
  rank: string;
  employmentStatus: string;
  bidCategory: string;
  isProbationary: boolean;
  rscSeniority: number;
  rankSeniority: number | null;
  certifications: {
    credentialId: number;
    name: string;
    status: string;
    effectiveOn: string | null;
    expiresOn: string | null;
  }[];
  specialties: { code: string; status: string }[];
  serviceCredits?: {
    serviceCode: string;
    verifiedMonths: number | null;
    effectiveOn: string;
    sourceRef: string;
  }[];
};
export function AnnualPlanParticipants({ plan }: { plan: AnnualPlan }) {
  const [search, setSearch] = useState('');
  const review = useQuery({
    queryKey: [
      'admin',
      'annual-plan',
      plan.year,
      'participants',
      plan.effectiveOn,
      plan.settings.credentialEvaluationOn,
    ],
    queryFn: () =>
      annualGet<{
        members: Member[];
        personnelOn: string;
        qualificationEvaluationOn: string;
        sourceRevision: number;
      }>(`annual-plan/${plan.year}/participants`),
    staleTime: 30_000,
    refetchInterval: plan.lifecycle === 'DRAFT' ? 60_000 : false,
  });
  const rows =
    review.data?.members.filter((m) =>
      `${m.firstName} ${m.lastName} ${m.rank} ${m.memberId}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  return (
    <div className="space-y-4">
      <p className="text-slate-300">
        Personnel as of {plan.effectiveOn}; qualifications as of{' '}
        {plan.settings.credentialEvaluationOn}. This evidence review does not grant annual
        participation. The operating policy and session preparation determine each pool.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link className={buttonClass} href={'/admin/personnel/service-evidence' as Route}>
          Review cumulative service evidence
        </Link>
        <Link className={buttonClass} href={'/admin/personnel' as Route}>
          Review personnel changes
        </Link>
        <Link className={buttonClass} href={'/admin/personnel/qualifications' as Route}>
          Review qualification evidence
        </Link>
      </div>
      <label className="block max-w-md">
        Search members
        <input className={fieldClass} value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      {review.isPending && <p>Loading dated evidence…</p>}
      {review.isError && (
        <p role="alert" className="text-amber-200">
          {review.error.message}. {review.data ? 'Last successful evidence remains visible.' : ''}
        </p>
      )}
      <p className="text-sm text-slate-400">
        {rows.length} members shown · Source revision {review.data?.sourceRevision ?? 'unavailable'}
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((m) => (
          <article key={m.memberId} className="min-w-0 rounded border border-slate-700 p-4">
            <h3 className="font-semibold">
              {m.firstName} {m.lastName}
            </h3>
            <p className="text-sm text-slate-300">
              {m.rank} · {m.employmentStatus} · Category {m.bidCategory} ·{' '}
              {m.isProbationary ? 'Probationary' : 'Non-probationary'}
            </p>
            <p className="text-sm text-slate-400">
              RSC seniority {m.rscSeniority}; rank seniority {m.rankSeniority ?? 'Unknown'}
            </p>
            {m.serviceCredits?.map((credit) => (
              <p key={credit.serviceCode} className="mt-2 text-sm text-slate-300">
                {credit.serviceCode.replaceAll('_', ' ')}:{' '}
                {credit.verifiedMonths === null
                  ? 'Unknown'
                  : `${credit.verifiedMonths} reviewed months`}{' '}
                as of {credit.effectiveOn}.
              </p>
            ))}
            <details className="mt-3">
              <summary className="cursor-pointer">
                Qualifications ({m.certifications.length}) and specialties ({m.specialties.length})
              </summary>
              <ul className="mt-2 space-y-2 text-sm">
                {m.certifications.map((q) => (
                  <li key={q.credentialId}>
                    {q.name}: {q.status} · Effective {q.effectiveOn ?? 'Unknown'} · Expires{' '}
                    {q.expiresOn ?? 'No recorded expiry'}
                  </li>
                ))}
                {m.specialties.map((q) => (
                  <li key={q.code}>
                    {q.code}: {q.status}
                  </li>
                ))}
              </ul>
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}
