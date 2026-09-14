import { requireAdmin } from '@/lib/require-admin';
import { CurrentBidWorkspace } from './CurrentBidWorkspace';

export const dynamic = 'force-dynamic';
export default async function CurrentBidPage({
  searchParams,
}: { searchParams: Promise<{ year?: string; view?: string }> }) {
  const claims = await requireAdmin();
  const search = await searchParams;
  const requested = search.year ?? String(new Date().getFullYear());
  if (!/^\d{4}$/.test(requested) || Number(requested) < 2024 || Number(requested) > 2100)
    return <p role="alert">Choose a Bid year between 2024 and 2100.</p>;
  const actorScope = `${claims.sub}:${claims.member_id}:${claims.security_version}`;
  const view =
    (['edit', 'blueprint', 'mock', 'live', 'results', 'versions'] as const).find(
      (view) => view === search.view,
    ) ?? 'edit';
  return (
    <CurrentBidWorkspace
      key={`${actorScope}:${requested}`}
      year={Number(requested)}
      actorScope={actorScope}
      initialView={view}
    />
  );
}
