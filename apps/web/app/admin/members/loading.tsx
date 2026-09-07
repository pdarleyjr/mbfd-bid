import { Skeleton } from '@/components/ui/skeleton';
export default function MembersLoading() {
  return (
    <div>
      <Skeleton className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <Skeleton className="mt-1 h-4 w-32 animate-pulse rounded bg-muted" />
      <div className="mt-6 overflow-hidden rounded-xl border border-border">
        <div className="border-b border-border bg-card px-4 py-3">
          <Skeleton className="h-3 w-3/4 animate-pulse rounded bg-muted" />
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
          <div key={i} className="border-b border-border bg-card px-4 py-3">
            <Skeleton className="h-4 w-full animate-pulse rounded bg-muted opacity-50" />
          </div>
        ))}
      </div>
    </div>
  );
}
