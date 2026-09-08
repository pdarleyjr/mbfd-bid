import { requireAdmin } from '@/lib/require-admin';
import Link from 'next/link';

/**
 * Deliberately non-operational. Infrastructure and publication settings stay
 * outside this web surface until a separately authorized implementation exists.
 */
export default async function SystemIntegrationsPage() {
  await requireAdmin();

  return (
    <section className="max-w-3xl space-y-6" aria-labelledby="system-integrations-heading">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Operational boundary
        </p>
        <h1 id="system-integrations-heading" className="mt-1 font-heading text-2xl text-foreground">
          System/Integrations
        </h1>
        <p className="mt-2 text-sm text-foreground">
          This area records the boundary between the Bid application and external operational
          systems.
        </p>
      </header>

      <div
        data-testid="system-integrations-unavailable"
        className="border-l-4 border-warning/40 bg-warning-surface px-4 py-4 text-sm text-warning"
      >
        <p className="font-semibold">Integration configuration is not available here</p>
        <p className="mt-1 text-warning">
          This read-only landing does not configure TeleStaff, portal publication, portal
          write-back, infrastructure, or a live bid. Portal write-back remains disabled.
        </p>
      </div>
      <nav aria-label="Integration workflows" className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/admin/targetsolutions"
          className="rounded-lg border border-border p-4 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h2 className="font-semibold">TargetSolutions credentials</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload an export, review changes and resume an existing import.
          </p>
        </Link>
        <Link
          href="/admin/telestaff"
          className="rounded-lg border border-border p-4 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h2 className="font-semibold">TeleStaff assignments</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Preview and reconcile assignment data before applying reviewed changes.
          </p>
        </Link>
        <Link
          href="/admin/exports"
          className="rounded-lg border border-border p-4 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h2 className="font-semibold">Exports and publication status</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Download available reports and inspect recorded publication results.
          </p>
        </Link>
        <Link
          href="/admin/docs#system-integrations"
          className="rounded-lg border border-border p-4 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h2 className="font-semibold">Integration instructions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Read the operating boundaries and complete administrator manual.
          </p>
        </Link>
      </nav>
    </section>
  );
}
