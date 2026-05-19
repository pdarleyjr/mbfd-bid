import { requireAdmin } from '../../../../lib/require-admin';
import { SessionControls } from './SessionControls';

export const runtime = 'edge';

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  return (
    <div>
      <h1 className="font-heading text-2xl text-white">
        Bid Session <span className="font-mono text-base text-slate-400">#{id}</span>
      </h1>
      <p className="mt-2 text-sm text-slate-300">
        Use the controls below to drive session lifecycle and admin overrides. Each action carries a
        reason code + free text and is recorded in the audit log.
      </p>
      <SessionControls sessionId={id} />
    </div>
  );
}
