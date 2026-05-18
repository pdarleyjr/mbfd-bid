import { UploadForm } from '@/components/admin/UploadForm';
import { requireAdmin } from '@/lib/require-admin';

export const runtime = 'edge';

export default async function MembersImportPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-display tracking-tight text-white">Import Members</h1>
        <p className="mt-2 text-stone-300">
          Upload the 2025 master CSV (export from{' '}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-sm">
            MASTER 2025 Bid Positions Selection V18 - FINAL.xlsx
          </code>
          ) or any equivalent member roster. Existing members (matched by Employee ID) are updated;
          new members are inserted.
        </p>
      </header>

      <UploadForm endpoint="/api/admin/members-import" accept=".csv,text/csv" label="Members CSV" />
    </div>
  );
}
