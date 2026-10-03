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
      <h1 className="font-heading text-2xl text-foreground">New Bid Session</h1>
      <p className="mt-2 text-sm text-foreground">
        Choose Mock or Real. The session uses the selected year&apos;s saved rules and settings.
        Creation prepares the session; Start opens bidding in the console.
      </p>
      <NewSessionForm defaultMock={defaultMock} />
    </div>
  );
}
