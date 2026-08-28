import { requireAdmin } from '@/lib/require-admin';

/**
 * Deliberately non-operational. Infrastructure and publication settings stay
 * outside this web surface until a separately authorized implementation exists.
 */
export default async function SystemIntegrationsPage() {
  await requireAdmin();

  return (
    <section className="max-w-3xl space-y-6" aria-labelledby="system-integrations-heading">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Operational boundary
        </p>
        <h1 id="system-integrations-heading" className="mt-1 font-heading text-2xl text-white">
          System/Integrations
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          This area records the boundary between the Bid application and external operational
          systems.
        </p>
      </header>

      <div
        data-testid="system-integrations-unavailable"
        className="border-l-4 border-amber-500 bg-amber-950/30 px-4 py-4 text-sm text-amber-100"
      >
        <p className="font-semibold">Integration configuration is not available here</p>
        <p className="mt-1 text-amber-100/90">
          This read-only landing does not configure TeleStaff, portal publication, portal
          write-back, infrastructure, or a live bid. Portal write-back remains disabled.
        </p>
      </div>
    </section>
  );
}
