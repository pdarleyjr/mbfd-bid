export default function Loading() {
  return (
    <div className="min-h-screen bg-stone-50">
      <div className="h-[57px] bg-slate-850" />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <div className="h-7 w-28 animate-pulse rounded bg-stone-200" />
        <div className="mt-4 h-4 w-64 animate-pulse rounded bg-stone-200" />
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-2xl border border-stone-200 bg-white"
            />
          ))}
        </div>
      </main>
    </div>
  );
}
