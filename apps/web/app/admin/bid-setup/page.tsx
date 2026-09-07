import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import type { Route } from 'next';
import Link from 'next/link';
import {
  type BidConfiguration,
  BidSetupWorkspace,
  type RuleBookSummary,
} from './BidSetupWorkspace';

export const dynamic = 'force-dynamic';

function bidYearFromSearchParam(value: string | undefined): number {
  const currentYear = new Date().getFullYear();
  if (value === undefined || !/^\d{4}$/.test(value)) return currentYear;
  const year = Number(value);
  return year >= 2024 && year <= 2100 ? year : currentYear;
}

async function loadConfiguration(year: number): Promise<{
  configuration: BidConfiguration | null;
  error: string | null;
}> {
  try {
    const response = await serverWorkerFetch(`/api/admin/bid-configuration/${year}`);
    if (response.status === 404) {
      return { configuration: null, error: 'Bid year is not configured.' };
    }
    if (!response.ok) {
      return { configuration: null, error: `Configuration service returned ${response.status}.` };
    }
    const body = (await response.json()) as { configuration?: BidConfiguration };
    if (body.configuration === undefined) {
      return { configuration: null, error: 'Configuration service returned no configuration.' };
    }
    return { configuration: body.configuration, error: null };
  } catch (caught) {
    return {
      configuration: null,
      error: caught instanceof Error ? caught.message : 'Configuration service request failed.',
    };
  }
}

async function loadRuleBooks(year: number): Promise<{
  ruleBooks: RuleBookSummary[];
  error: string | null;
}> {
  try {
    const response = await serverWorkerFetch(`/api/admin/rule-books?effective_year=${year}`);
    if (!response.ok) {
      return { ruleBooks: [], error: `Rule-book service returned ${response.status}.` };
    }
    const body = (await response.json()) as { rule_books?: RuleBookSummary[] };
    return { ruleBooks: body.rule_books ?? [], error: null };
  } catch (caught) {
    return {
      ruleBooks: [],
      error: caught instanceof Error ? caught.message : 'Rule-book service request failed.',
    };
  }
}

export default async function BidSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireAdmin();
  const year = bidYearFromSearchParam((await searchParams).year);
  const [configurationResult, ruleBooksResult] = await Promise.all([
    loadConfiguration(year),
    loadRuleBooks(year),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          MBFD annual bid control center
        </p>
        <h1 className="mt-1 font-heading text-2xl text-foreground">Bid Setup</h1>
        <p className="mt-2 max-w-3xl text-sm text-foreground">
          Review and, when the server permits it, designate the one annual configuration used by
          mock and eventual live sessions. Staffing baselines remain outside this workspace.
        </p>
      </header>

      <Link
        href={`/admin/annual-plan?year=${year}&stage=1` as Route}
        className="mt-5 inline-block rounded border border-warning/40 px-4 py-3 text-sm font-semibold text-warning"
      >
        Prepare Next Bid
      </Link>
      <form method="get" className="mt-5 flex max-w-sm items-end gap-3">
        <Label className="block flex-1">
          <span className="text-sm text-foreground">Bid year</span>
          <Input
            name="year"
            type="number"
            min={2024}
            max={2100}
            defaultValue={year}
            className="mt-1 block w-full rounded border border-border bg-card px-3 py-2 text-foreground"
          />
        </Label>
        <Button
          type="submit"
          className="rounded border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-card"
        >
          View year
        </Button>
      </form>

      <p className="mt-5 rounded border border-warning/40 bg-warning-surface px-4 py-3 text-sm text-warning">
        Check the staffing baseline and unresolved assignments in Staffing → Import TeleStaff
        assignments. Approving setup preserves the rules and evidence used for this bid.
      </p>

      <div className="mt-6">
        <BidSetupWorkspace
          key={`${year}:${configurationResult.configuration?.configurationRevision ?? 'missing'}`}
          year={year}
          configuration={configurationResult.configuration}
          ruleBooks={ruleBooksResult.ruleBooks}
          configurationError={configurationResult.error}
          ruleBooksError={ruleBooksResult.error}
        />
      </div>
    </div>
  );
}
