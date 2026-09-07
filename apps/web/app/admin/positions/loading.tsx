import { Skeleton } from '@/components/ui/skeleton';
export default function PositionsLoading() {
  return (
    <div>
      <Skeleton className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <Skeleton className="mt-1 h-4 w-64 animate-pulse rounded bg-muted" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <Skeleton className="h-5 w-32 animate-pulse rounded bg-muted" />
            <div className="mt-3 space-y-2">
              {Array.from({ length: 3 }).map((_, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
                <div key={j} className="h-4 w-full animate-pulse rounded bg-muted opacity-50" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
