import { requireAdmin } from '../../../../lib/require-admin';
import { NewSessionForm } from './NewSessionForm';

export const runtime = 'edge';

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ mock?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const defaultMock = sp.mock === '1' || sp.mock === 'true';
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-heading text-2xl text-white">New Bid Session</h1>
      <p className="mt-2 text-sm text-slate-300">
        Configure a new bid session for the selected year. Session is created in <code>config</code>{' '}
        phase; press Start to transition to <code>position_bid</code>.
      </p>
      <NewSessionForm defaultMock={defaultMock} />
    </div>
  );
}
