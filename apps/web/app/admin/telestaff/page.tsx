import { requireAdmin } from '@/lib/require-admin';

import { TeleStaffOperatorWorkspace } from './TeleStaffOperatorWorkspace';

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
          Upload, parse, reconcile, review, and carefully apply an approved operational staffing
          export without blind overwrite.
        </p>
      </header>

      <TeleStaffOperatorWorkspace />
    </section>
  );
}
