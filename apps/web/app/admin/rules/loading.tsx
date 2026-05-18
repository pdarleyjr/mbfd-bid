export default function RulesLoading() {
  return (
    <div>
      <div className="h-8 w-40 animate-pulse rounded-md bg-slate-700" />
      <div className="mt-1 h-4 w-64 animate-pulse rounded bg-slate-700" />
      <div className="mt-6 rounded-xl border border-slate-700 bg-slate-850 p-4">
        <div className="h-5 w-32 animate-pulse rounded bg-slate-700" />
        <div className="mt-3 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
            <div key={i} className="rounded-lg border border-slate-700 bg-slate-800 p-3">
              <div className="h-4 w-48 animate-pulse rounded bg-slate-700" />
              <div className="mt-2 space-y-1">
                <div className="h-3 w-full animate-pulse rounded bg-slate-700 opacity-40" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-slate-700 opacity-30" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
