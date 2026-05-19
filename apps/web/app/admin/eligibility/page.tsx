import { requireAdmin } from '../../../lib/require-admin';

export default async function EligibilityPreviewPage() {
  await requireAdmin();
  return (
    <div>
      <h1 className="font-heading text-2xl text-white">Eligibility Preview</h1>
      <p className="mt-2 text-sm text-slate-300">
        Coming soon — Plan 05 Task 24 will wire up the eligibility preview tool.
      </p>
    </div>
  );
}
