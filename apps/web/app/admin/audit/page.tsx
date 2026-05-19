import { requireAdmin } from '../../../lib/require-admin';

export default async function AuditPage() {
  await requireAdmin();
  return (
    <div>
      <h1 className="font-heading text-2xl text-white">Audit Log</h1>
      <p className="mt-2 text-sm text-slate-300">
        Coming soon — Plan 05 Task 23 will wire up the audit log viewer + CSV export.
      </p>
    </div>
  );
}
