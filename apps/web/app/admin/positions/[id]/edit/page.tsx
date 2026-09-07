import { type BoundToolSearchParams, buildBoundToolHref } from '@/lib/bid-configuration-selection';
import { loadBoundBidConfiguration } from '@/lib/load-bound-bid-configuration';
import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import type { Route } from 'next';
import Link from 'next/link';
import { RuleEditor } from './RuleEditor';

export const dynamic = 'force-dynamic';

interface ParsedRule {
  id: number;
  positionId: string;
  requiredCriteria: unknown;
  pointsPreference: unknown;
  tieBreakChain: unknown;
}

async function loadConfiguredDraftRule(
  positionId: string,
  ruleBookVersion: string,
): Promise<ParsedRule | null> {
  const rulesRes = await serverWorkerFetch(
    `/api/admin/rules?rule_book_version=${encodeURIComponent(ruleBookVersion)}`,
  );
  if (!rulesRes.ok) return null;
  const rulesBody = (await rulesRes.json()) as { rules?: ParsedRule[] };
  return rulesBody.rules?.find((rule) => rule.positionId === positionId) ?? null;
}

export default async function PositionEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<BoundToolSearchParams>;
}) {
  await requireAdmin();
  const { id } = await params;
  const binding = await loadBoundBidConfiguration(await searchParams);
  if (binding.error !== null) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="font-heading text-2xl text-foreground">Edit configured rule</h1>
        <p className="mt-4 rounded border border-warning/40 bg-warning-surface p-3 text-sm text-warning">
          {binding.error}{' '}
          <Link href="/admin/bid-setup" className="font-semibold underline">
            Return to Bid Setup
          </Link>
        </p>
      </div>
    );
  }
  if (binding.configuration.lifecycle !== 'DRAFT') {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="font-heading text-2xl text-foreground">Edit configured rule</h1>
        <p className="mt-4 rounded border border-border bg-card p-3 text-sm text-foreground">
          The selected rule book is frozen and cannot be edited. Return to the configured position
          view to review it.
        </p>
      </div>
    );
  }

  const rule = await loadConfiguredDraftRule(id, binding.configuration.ruleBookVersion);
  const positionsHref = buildBoundToolHref('/admin/positions', binding.configuration);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-heading text-2xl text-foreground">Edit Rule for Position {id}</h1>
      <p className="mt-2 text-sm text-foreground">
        Edits apply only to configured draft rule book{' '}
        <span className="font-mono text-foreground">{binding.configuration.ruleBookVersion}</span>.
        PATCH to the worker carries a step-up auth requirement; if the session is older than 5
        minutes you will be prompted to re-authenticate.
      </p>
      {rule === null && (
        <p className="mt-4 rounded border border-warning/40 bg-warning-surface p-3 text-sm text-warning">
          No rule for this position exists in the configured draft. No raw rule-ID entry is offered;
          review the designated rule book before creating or cloning policy data.
        </p>
      )}
      {positionsHref !== null && (
        <Link
          href={positionsHref as Route}
          className="mt-4 inline-block text-sm text-destructive underline"
        >
          Return to configured Positions
        </Link>
      )}
      {rule ? (
        <RuleEditor
          positionId={id}
          ruleBookVersion={binding.configuration.ruleBookVersion}
          ruleBookRevision={binding.configuration.ruleBookRevision}
          initialRule={rule}
        />
      ) : null}
    </div>
  );
}
