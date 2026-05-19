import { requireAdmin } from '../../../../lib/require-admin';

export default async function NewSessionPage() {
  await requireAdmin();
  return (
    <div>
      <h1 className="font-heading text-2xl text-white">New Bid Session</h1>
      <p className="mt-2 text-sm text-slate-300">
        Coming soon — Plan 05 Task 22 will wire up the bid-session console.
      </p>
    </div>
  );
}
