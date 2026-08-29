import type { Route } from 'next';
import Link from 'next/link';
import { type BidConfiguration, buildBoundToolHref } from '../../lib/bid-configuration-selection';

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

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="mt-2">
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1 overflow-x-auto rounded bg-slate-900 px-3 py-2 font-mono text-xs text-slate-300">
        <pre className="whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>
      </dd>
    </div>
  );
}

interface RuleNodeProps {
  rule: ParsedRule;
  configuration: BidConfiguration;
}

export function RuleNode({ rule, configuration }: RuleNodeProps) {
  return (
    <details open className="mt-3 rounded-lg border border-slate-700 bg-slate-800">
      <summary className="flex cursor-pointer select-none items-center justify-between rounded-lg px-4 py-3 hover:bg-slate-750 transition-colors duration-fast ease-out-quart">
        <span className="font-mono text-sm text-red-400 [font-variant-numeric:tabular-nums]">
          {rule.positionId}
        </span>
        <span className="font-mono text-xs text-slate-500 [font-variant-numeric:tabular-nums]">
          #{rule.id}
        </span>
      </summary>
      <dl className="px-4 pb-4">
        <div className="mt-2">
          {configuration.lifecycle === 'DRAFT' ? (
            <Link
              href={
                buildBoundToolHref(
                  `/admin/positions/${encodeURIComponent(rule.positionId)}/edit`,
                  configuration,
                ) as Route
              }
              className="text-sm font-medium text-red-400 underline hover:text-red-300"
            >
              Edit configured draft rule
            </Link>
          ) : (
            <span className="text-sm text-slate-400">Configured rule book is frozen.</span>
          )}
        </div>
        <JsonBlock label="Required Criteria" value={rule.requiredCriteria} />
        <JsonBlock label="Points Preference" value={rule.pointsPreference} />
        <JsonBlock label="Tie-Break Chain" value={rule.tieBreakChain} />
        {rule.notes && (
          <div className="mt-2">
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Notes</dt>
            <dd className="mt-1 text-sm text-slate-400">{rule.notes}</dd>
          </div>
        )}
        <div className="mt-2">
          <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Template</dt>
          <dd className="mt-1 font-mono text-xs text-slate-400">{rule.templateVersion}</dd>
        </div>
      </dl>
    </details>
  );
}
