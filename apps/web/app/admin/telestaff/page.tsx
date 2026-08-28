import { requireAdmin } from '@/lib/require-admin';

/**
 * A safe landing state for the future TeleStaff reconciliation workflow. No
 * import, apply, or authoritative assignment operation is exposed here.
 */
export default async function TeleStaffPage() {
  await requireAdmin();

  return (
    <section className="max-w-3xl space-y-6" aria-labelledby="telestaff-heading">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Operational staffing source
        </p>
        <h1 id="telestaff-heading" className="mt-1 font-heading text-2xl text-white">
          TeleStaff
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          Upload, parse, normalize, preview, reconcile, review, and apply an approved operational
          staffing export without blind overwrite.
        </p>
      </header>

      <div
        data-testid="telestaff-workflow-blocker"
        className="border-l-4 border-amber-500 bg-amber-950/30 px-4 py-4 text-sm text-amber-100"
      >
        <p className="font-semibold">Authoritative staffing baseline not loaded</p>
        <p className="mt-1 text-amber-100/90">
          No import or apply controls are available in this state. The future workflow will require
          explicit mapping review; unknown and ambiguous records must block authoritative commit.
        </p>
      </div>
    </section>
  );
}
