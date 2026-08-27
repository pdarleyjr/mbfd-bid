import { requireAdmin } from '../../../lib/require-admin';
import { EligibilityPreviewForm } from './EligibilityPreviewForm';

export default async function EligibilityPreviewPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-heading text-2xl text-white">Eligibility Preview</h1>
      <p className="mt-2 text-sm text-slate-300">
        Enter a member ID + position ID to evaluate the active rule book (or pass an explicit
        version). Useful before publishing a rule-book change.
      </p>
      <EligibilityPreviewForm />
    </div>
  );
}
