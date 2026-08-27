import { UploadForm } from '@/components/admin/UploadForm';
import { requireAdmin } from '@/lib/require-admin';

function ModeFields() {
  return (
    <>
      <label className="flex flex-col gap-2 text-stone-200">
        <span>Import mode</span>
        <select
          name="mode"
          defaultValue="normalized"
          className="rounded border border-stone-600 bg-slate-900 p-2 text-stone-100"
        >
          <option value="normalized">Normalized (one credential per row)</option>
          <option value="legacy_wide_matrix">Legacy wide matrix (2025 master file)</option>
        </select>
      </label>
      <label className="flex flex-col gap-2 text-stone-200">
        <span>Metadata columns (legacy mode)</span>
        <input
          type="number"
          name="metadata_columns"
          defaultValue={4}
          min={0}
          className="rounded border border-stone-600 bg-slate-900 p-2 text-stone-100 w-24"
        />
        <span className="text-xs text-stone-400">
          Number of leading columns that are member metadata, not credential columns. Default is 4
          for the 2025 master file (Employee ID, Name, Rank, Hire Date).
        </span>
      </label>
    </>
  );
}

export default async function CredentialsImportPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-display tracking-tight text-white">Import Credentials</h1>
        <p className="mt-2 text-stone-300">
          Upload a credentials XLSX file. Use <strong className="text-white">Normalized</strong>{' '}
          mode for standard one-row-per-credential exports, or{' '}
          <strong className="text-white">Legacy wide matrix</strong> for the 2025 master file format
          where each credential is a column. Existing records (matched by Employee ID + credential
          type) are updated; new records are inserted.
        </p>
      </header>

      <UploadForm
        endpoint="/api/admin/credentials-import"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        label="Credentials XLSX"
        extraFields={<ModeFields />}
      />
    </div>
  );
}
