import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import { type ReadinessItem, ReadinessWorkspace } from './ReadinessWorkspace';

export default async function CertificationReadinessPage() {
  await requireAdmin();
  const response = await serverWorkerFetch('/api/admin/qualification-lifecycle/readiness');
  if (!response.ok)
    return (
      <section className="rounded-xl border border-amber-700 bg-amber-950/30 p-5 text-amber-100">
        <h1 className="font-heading text-2xl">Certification readiness unavailable</h1>
        <p className="mt-2">
          The read-only readiness projection could not be loaded. No qualification status was
          inferred.
        </p>
      </section>
    );
  const body = (await response.json()) as { items: ReadinessItem[]; annualDetermination: string };
  return (
    <section className="mx-auto max-w-7xl space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-red-300">
          Command staff readiness
        </p>
        <h1 className="mt-1 font-heading text-3xl text-white">Certification readiness</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Effective-dated credential and specialty evidence, filtered for operational review.
          TeleStaff remains an observed roster and no external writeback is available here.
        </p>
      </header>
      <ReadinessWorkspace items={body.items} annualDetermination={body.annualDetermination} />
    </section>
  );
}
