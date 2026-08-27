import { requireAdmin } from '../../../../../lib/require-admin';
import { serverWorkerFetch } from '../../../../../lib/server-worker-fetch';
import { RuleEditor } from './RuleEditor';

export const dynamic = 'force-dynamic';

interface RuleBook {
  version: string;
  status: 'draft' | 'active' | 'archived';
}

interface ParsedRule {
  id: number;
  positionId: string;
  requiredCriteria: unknown;
  pointsPreference: unknown;
  tieBreakChain: unknown;
}

async function loadDraftRule(positionId: string): Promise<ParsedRule | null> {
  const booksRes = await serverWorkerFetch('/api/admin/rule-books');
  if (!booksRes.ok) return null;
  const booksBody = (await booksRes.json()) as { rule_books?: RuleBook[] };
  const draft = booksBody.rule_books?.find((book) => book.status === 'draft');
  if (!draft) return null;

  const rulesRes = await serverWorkerFetch(
    `/api/admin/rules?rule_book_version=${encodeURIComponent(draft.version)}`,
  );
  if (!rulesRes.ok) return null;
  const rulesBody = (await rulesRes.json()) as { rules?: ParsedRule[] };
  return rulesBody.rules?.find((rule) => rule.positionId === positionId) ?? null;
}

export default async function PositionEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const rule = await loadDraftRule(id);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-heading text-2xl text-white">Edit Rule for Position {id}</h1>
      <p className="mt-2 text-sm text-slate-300">
        Edits apply to the draft rule book only. PATCH to the worker carries a step-up auth
        requirement; if the session is older than 5 minutes you will be prompted to re-authenticate.
      </p>
      {rule === null && (
        <p className="mt-4 rounded border border-amber-600 bg-amber-950/30 p-3 text-sm text-amber-200">
          No draft rule was found for this position. Create or clone a draft rule book before saving
          edits.
        </p>
      )}
      {rule ? <RuleEditor positionId={id} initialRule={rule} /> : <RuleEditor positionId={id} />}
    </div>
  );
}
