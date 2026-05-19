import { requireAdmin } from '../../../lib/require-admin';

export default async function RuleBooksPage() {
  await requireAdmin();
  return (
    <div>
      <h1 className="font-heading text-2xl text-white">Rule Books</h1>
      <p className="mt-2 text-sm text-slate-300">
        Coming soon — Plan 05 Task 21 will wire up the list, create, and publish UI.
      </p>
    </div>
  );
}
