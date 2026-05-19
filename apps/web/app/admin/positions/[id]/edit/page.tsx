import { requireAdmin } from '../../../../../lib/require-admin';
import { RuleEditor } from './RuleEditor';

export const runtime = 'edge';

export default async function PositionEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-heading text-2xl text-white">Edit Rule for Position {id}</h1>
      <p className="mt-2 text-sm text-slate-300">
        Edits apply to the draft rule book only. PATCH to the worker carries a step-up auth
        requirement; if the session is older than 5 minutes you will be prompted to re-authenticate.
      </p>
      <RuleEditor positionId={id} />
    </div>
  );
}
