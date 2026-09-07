export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-[57px] bg-sidebar" />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <div className="h-7 w-28 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-4 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl border border-border bg-white" />
          ))}
        </div>
      </main>
    </div>
  );
}
