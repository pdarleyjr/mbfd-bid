import { requireAdmin } from '../../../../lib/require-admin';
import { SessionControls } from './SessionControls';
import { SessionOperatorLinks } from './SessionOperatorLinks';

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  return (
    <div>
      <h1 className="font-heading text-2xl text-foreground">Bid session controls</h1>
      <p className="mt-2 text-sm text-foreground">
        Use the controls below to drive session lifecycle and admin overrides. Each action carries a
        reason code + free text and is recorded in the audit log.
      </p>
      <SessionOperatorLinks sessionId={id} />
      <SessionControls sessionId={id} />
    </div>
  );
}
