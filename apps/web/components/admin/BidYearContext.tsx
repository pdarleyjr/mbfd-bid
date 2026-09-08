'use client';
import { annualGet } from '@/app/admin/annual-plan/annual-plan-client';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

const KEY = 'mbfd-admin-bid-year';
const YEAR_ROUTES = [
  '/admin/annual-plan',
  '/admin/source-review',
  '/admin/annual-policy',
  '/admin/bid-setup',
  '/admin/bid-board',
];
const valid = (year: number) => Number.isInteger(year) && year >= 2024 && year <= 2100;

/** Only remembers a navigation preference. Never supplies an authoritative policy date. */
export function BidYearContext() {
  const path = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const selected = Number(params.get('year'));
  const context = useQuery({
    queryKey: ['admin', 'annual-plan', selected, 'context'],
    enabled: YEAR_ROUTES.includes(path) && valid(selected),
    staleTime: 30_000,
    queryFn: () =>
      annualGet<{
        plan: {
          lifecycle: string;
          ruleBookVersion: string | null;
          configurationRevision: number;
          effectiveOn: string | null;
          settings: { credentialEvaluationOn?: string } | null;
          baseline: { id: string; acceptedAt: number } | null;
          sessions: { id: string; isMock: number; currentPhase: string }[];
        };
      }>(`annual-plan/${selected}`),
  });
  useEffect(() => {
    try {
      if (valid(selected)) window.localStorage.setItem(KEY, String(selected));
      else if (YEAR_ROUTES.includes(path)) {
        const remembered = Number(window.localStorage.getItem(KEY));
        const next = new URLSearchParams(params.toString());
        next.set('year', String(valid(remembered) ? remembered : new Date().getFullYear()));
        router.replace(`${path}?${next}` as Route);
      }
    } catch {
      /* Navigation remains functional when browser storage is unavailable. */
    }
  }, [path, params, selected, router]);
  if (!YEAR_ROUTES.includes(path)) return null;
  const plan = context.data?.plan;
  const status = plan
    ? ({ DRAFT: 'Preparing', FROZEN: 'Setup approved', UNCONFIGURED: 'Not started' }[
        plan.lifecycle
      ] ?? 'Needs review')
    : context.isError
      ? 'Unavailable'
      : 'Loading…';
  return (
    <aside
      aria-label="Selected annual bid"
      className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border pb-2 text-sm"
    >
      <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1">
        <Link
          href={
            `/admin/annual-plan?year=${valid(selected) ? selected : new Date().getFullYear()}` as Route
          }
          className="font-semibold underline underline-offset-4"
        >
          {valid(selected) ? selected : 'Selected year'} Annual Bid · {status}
        </Link>
        {plan && (
          <span className="text-muted-foreground">
            Qualifications: {plan.settings?.credentialEvaluationOn ?? 'Date needs review'}
          </span>
        )}
      </div>
      {context.isError && (
        <button
          type="button"
          className="mt-1 min-h-11 underline"
          onClick={() => void context.refetch()}
        >
          Retry annual context
        </button>
      )}
      {plan && (
        <details className="group open:basis-full">
          <summary
            aria-label="Setup, staffing and sessions"
            className="min-h-11 content-center cursor-pointer text-xs text-muted-foreground"
          >
            <span className="sm:hidden">Setup details</span>
            <span className="hidden sm:inline">Setup, staffing and sessions</span>
          </summary>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs">
            <span>
              Rules: {plan.ruleBookVersion ?? 'Not designated'} · Revision{' '}
              {plan.configurationRevision}
            </span>
            <span>Personnel date: {plan.effectiveOn ?? 'Needs review'}</span>
            <Link className="underline" href={`/admin/source-review?year=${selected}` as Route}>
              Staffing baseline: {plan.baseline ? 'Accepted source' : 'Review required'}
            </Link>
            {(plan.sessions ?? []).length ? (
              plan.sessions.map((s) => (
                <Link
                  key={s.id}
                  className="underline"
                  href={`/admin/sessions/${encodeURIComponent(s.id)}` as Route}
                >
                  {s.isMock ? 'Practice' : 'Real bid'} · {s.currentPhase.replaceAll('_', ' ')}
                </Link>
              ))
            ) : (
              <span>No sessions created</span>
            )}
          </div>
        </details>
      )}
    </aside>
  );
}
