import { requireAdmin } from '../../../../lib/require-admin';
import { NewSessionForm } from './NewSessionForm';

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ mock?: string; mode?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const defaultMock = !(sp.mock === '0' || sp.mock === 'false' || sp.mode === 'live');
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-heading text-2xl text-white">New Bid Session</h1>
      <p className="mt-2 text-sm text-slate-300">
        Create a rehearsal session from the selected year&apos;s designated annual configuration.
        Rehearsal is selected by default; an explicit live-mode choice remains available but is
        independently server-gated. Session settings cannot diverge between mock and eventual live
        mode. The session is created in <code>config</code> phase; the separate live-readiness gate
        remains closed.
      </p>
      <NewSessionForm defaultMock={defaultMock} />
    </div>
  );
}
