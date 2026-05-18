export default function MembersLoading() {
  return (
    <div>
      <div className="h-8 w-48 animate-pulse rounded-md bg-slate-700" />
      <div className="mt-1 h-4 w-32 animate-pulse rounded bg-slate-700" />
      <div className="mt-6 overflow-hidden rounded-xl border border-slate-700">
        <div className="border-b border-slate-700 bg-slate-800 px-4 py-3">
          <div className="h-3 w-3/4 animate-pulse rounded bg-slate-700" />
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
          <div key={i} className="border-b border-slate-700 bg-slate-850 px-4 py-3">
            <div className="h-4 w-full animate-pulse rounded bg-slate-700 opacity-50" />
          </div>
        ))}
      </div>
    </div>
  );
}
