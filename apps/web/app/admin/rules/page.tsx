import { RuleNode } from '@/components/admin/RuleNode';
import { requireAdmin } from '@/lib/require-admin';
import { getServerRpc } from '@/lib/rpc-server';

interface ParsedRule {
  id: number;
  ruleBookVersion: string;
  positionId: string;
  templateVersion: string;
  requiredCriteria: unknown;
  pointsPreference: unknown;
  tieBreakChain: unknown;
  notes: string | null;
}

interface RulesResponse {
  rules: ParsedRule[];
  ruleBookVersion: string;
  count: number;
}

const RULE_BOOK_VERSION = '2026.1';

export default async function AdminRulesPage() {
  await requireAdmin();

  const client = await getServerRpc();

  let rules: ParsedRule[] = [];
  let ruleBookVersion = RULE_BOOK_VERSION;
  let fetchError: string | null = null;

  try {
    // biome-ignore lint/suspicious/noExplicitAny: WorkerClient is typed as any — see rpc-client.ts
    const res = await (client as any).api.admin.rules.$get({
      query: { rule_book_version: RULE_BOOK_VERSION },
    });
    if (res.ok) {
      const data = (await res.json()) as RulesResponse;
      rules = data.rules;
      ruleBookVersion = data.ruleBookVersion;
    } else {
      fetchError = `API error: ${res.status}`;
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Failed to fetch rules';
  }

  // Group by positionId prefix (for display — just group by first segment of position id)
  // Tree: ruleBookVersion → positionId → rule details
  const byPosition = new Map<string, ParsedRule[]>();
  for (const rule of rules) {
    if (!byPosition.has(rule.positionId)) {
      byPosition.set(rule.positionId, []);
    }
    (byPosition.get(rule.positionId) as ParsedRule[]).push(rule);
  }
  const positionIds = Array.from(byPosition.keys()).sort();

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-white">Rules</h1>
          <p className="mt-1 text-sm text-slate-400">
            Rule book: <span className="font-mono text-slate-300">{ruleBookVersion}</span>
            {!fetchError && (
              <>
                {' '}
                &bull; {rules.length} rule{rules.length !== 1 ? 's' : ''}
              </>
            )}
          </p>
        </div>
      </div>

      {fetchError ? (
        <p className="mt-6 rounded-xl border border-red-700/40 bg-red-900/20 px-4 py-6 text-center text-slate-300">
          Could not load rules. Check worker connectivity.
        </p>
      ) : (
        <section className="mt-6">
          <div className="rounded-xl border border-slate-700 bg-slate-850 p-4">
            <h2 className="font-heading text-base font-semibold text-white">
              <span className="font-mono text-red-400">{ruleBookVersion}</span>
              <span className="ml-2 font-mono text-xs text-slate-500">
                ({positionIds.length} position{positionIds.length !== 1 ? 's' : ''})
              </span>
            </h2>
            <div className="mt-2">
              {positionIds.length === 0 ? (
                <p className="text-sm text-slate-500">No rules found for this rule book version.</p>
              ) : (
                positionIds.map((positionId) => {
                  const posRules = byPosition.get(positionId) as ParsedRule[];
                  return posRules.map((rule) => <RuleNode key={rule.id} rule={rule} />);
                })
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
