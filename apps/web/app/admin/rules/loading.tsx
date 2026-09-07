import { Skeleton } from '@/components/ui/skeleton';
export default function RulesLoading() {
  return (
    <div>
      <Skeleton className="h-8 w-40 animate-pulse rounded-md bg-muted" />
      <Skeleton className="mt-1 h-4 w-64 animate-pulse rounded bg-muted" />
      <div className="mt-6 rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-5 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-3 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
            <div key={i} className="rounded-lg border border-border bg-card p-3">
              <Skeleton className="h-4 w-48 animate-pulse rounded bg-muted" />
              <div className="mt-2 space-y-1">
                <Skeleton className="h-3 w-full animate-pulse rounded bg-muted opacity-40" />
                <Skeleton className="h-3 w-3/4 animate-pulse rounded bg-muted opacity-30" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
