import { requireAdmin } from '@/lib/require-admin';

export default async function MembersImportPage() {
  await requireAdmin();

  return (
    <div>
      <h1 className="font-heading text-2xl text-white">Import Members</h1>
      <p className="mt-2 text-sm text-slate-400">
        Member CSV import will be implemented in a future task.
      </p>
    </div>
  );
}
