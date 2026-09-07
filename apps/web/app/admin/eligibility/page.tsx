import type { BoundToolSearchParams } from '@/lib/bid-configuration-selection';
import { loadBoundBidConfiguration } from '@/lib/load-bound-bid-configuration';
import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import Link from 'next/link';
import {
  type EligibilityMemberOption,
  type EligibilityPositionOption,
  EligibilityPreviewForm,
} from './EligibilityPreviewForm';

interface MembersResponse {
  members: EligibilityMemberOption[];
  total: number;
}

interface PositionsResponse {
  positions: EligibilityPositionOption[];
}

async function loadSelectorOptions(
  templateVersion: string,
): Promise<
  | { members: EligibilityMemberOption[]; positions: EligibilityPositionOption[]; error: null }
  | { members: []; positions: []; error: string }
> {
  try {
    const [membersResponse, positionsResponse] = await Promise.all([
      serverWorkerFetch('/api/admin/members?limit=500&offset=0'),
      serverWorkerFetch(
        `/api/admin/positions?template_version=${encodeURIComponent(templateVersion)}`,
      ),
    ]);
    if (!membersResponse.ok || !positionsResponse.ok) {
      return {
        members: [],
        positions: [],
        error: 'The configured member or position selector could not be loaded.',
      };
    }
    const [membersBody, positionsBody] = (await Promise.all([
      membersResponse.json(),
      positionsResponse.json(),
    ])) as [MembersResponse, PositionsResponse];
    const members = membersBody.members ?? [];
    if (membersBody.total > members.length) {
      return {
        members: [],
        positions: [],
        error:
          'The configured member selector is incomplete. No raw-ID fallback is offered; narrow the source or use the approved roster workflow.',
      };
    }
    return { members, positions: positionsBody.positions ?? [], error: null };
  } catch {
    return {
      members: [],
      positions: [],
      error: 'The configured member or position selector could not be loaded.',
    };
  }
}

export default async function EligibilityPreviewPage({
  searchParams,
}: {
  searchParams: Promise<BoundToolSearchParams>;
}) {
  await requireAdmin();
  const binding = await loadBoundBidConfiguration(await searchParams);

  if (binding.error !== null) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="font-heading text-2xl text-foreground">Eligibility Preview</h1>
        <p className="mt-6 rounded border border-warning/40 bg-warning-surface p-4 text-sm text-warning">
          {binding.error}{' '}
          <Link href="/admin/bid-setup" className="font-semibold underline">
            Return to Bid Setup
          </Link>
        </p>
      </div>
    );
  }

  const selectors = await loadSelectorOptions(binding.configuration.positionTemplateVersion);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-heading text-2xl text-foreground">Eligibility Preview</h1>
      <p className="mt-2 text-sm text-foreground">
        Review one configured member and position against the exact designated rule book. The
        selection remains bound to the Bid Setup revision and never infers a different annual rule
        book.
      </p>
      {selectors.error !== null ? (
        <p className="mt-6 rounded border border-warning/40 bg-warning-surface p-4 text-sm text-warning">
          {selectors.error}
        </p>
      ) : (
        <EligibilityPreviewForm
          ruleBookVersion={binding.configuration.ruleBookVersion}
          positionTemplateVersion={binding.configuration.positionTemplateVersion}
          members={selectors.members}
          positions={selectors.positions}
        />
      )}
    </div>
  );
}
