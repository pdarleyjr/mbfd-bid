import { RuleNode } from '@/components/admin/RuleNode';
import type { BoundToolSearchParams } from '@/lib/bid-configuration-selection';
import { loadBoundBidConfiguration } from '@/lib/load-bound-bid-configuration';
import { requireAdmin } from '@/lib/require-admin';
import { getServerRpc } from '@/lib/rpc-server';
import Link from 'next/link';

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

export default async function AdminRulesPage({
  searchParams,
}: {
  searchParams: Promise<BoundToolSearchParams>;
}) {
  await requireAdmin();

  const binding = await loadBoundBidConfiguration(await searchParams);
  if (binding.error !== null) {
    return (
      <div>
        <h1 className="font-heading text-2xl text-foreground">Rules</h1>
        <p className="mt-6 rounded-xl border border-warning/40 bg-warning-surface px-4 py-6 text-sm text-warning">
          {binding.error}{' '}
          <Link href="/admin/bid-setup" className="font-semibold underline">
            Return to Bid Setup
          </Link>
        </p>
      </div>
    );
  }

  const client = await getServerRpc();

  let rules: ParsedRule[] = [];
  let ruleBookVersion = binding.configuration.ruleBookVersion;
  let fetchError: string | null = null;

  try {
    // biome-ignore lint/suspicious/noExplicitAny: WorkerClient is typed as any — see rpc-client.ts
    const res = await (client as any).api.admin.rules.$get({
      query: { rule_book_version: binding.configuration.ruleBookVersion },
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
          <h1 className="font-heading text-2xl text-foreground">Rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Rule book: <span className="font-mono text-foreground">{ruleBookVersion}</span>
            {!fetchError && (
              <>
                {' '}
                &bull; {rules.length} rule{rules.length !== 1 ? 's' : ''}
              </>
            )}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Annual configuration: year {binding.configuration.bidYear} &bull; template{' '}
            <span className="font-mono text-foreground">
              {binding.configuration.positionTemplateVersion}
            </span>{' '}
            &bull; revision {binding.configuration.configurationRevision}
          </p>
        </div>
      </div>

      {fetchError ? (
        <p className="mt-6 rounded-xl border border-destructive/40 bg-destructive-surface px-4 py-6 text-center text-foreground">
          Could not load rules. Check worker connectivity.
        </p>
      ) : (
        <section className="mt-6">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-heading text-base font-semibold text-foreground">
              <span className="font-mono text-destructive">{ruleBookVersion}</span>
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                ({positionIds.length} position{positionIds.length !== 1 ? 's' : ''})
              </span>
            </h2>
            <div className="mt-2">
              {positionIds.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No rules found for this rule book version.
                </p>
              ) : (
                positionIds.map((positionId) => {
                  const posRules = byPosition.get(positionId) as ParsedRule[];
                  return posRules.map((rule) => (
                    <RuleNode key={rule.id} rule={rule} configuration={binding.configuration} />
                  ));
                })
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
