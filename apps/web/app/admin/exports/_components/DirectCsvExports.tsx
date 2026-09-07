interface Props {
  sessionId: string;
}

/**
 * These downloads are generated from the reviewed session snapshot rather
 * than relying on optional R2/PDF rendering infrastructure.
 */
export function DirectCsvExports({ sessionId }: Props) {
  const encodedSessionId = encodeURIComponent(sessionId);

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-heading text-lg font-semibold">Direct CSV downloads</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Progress and award exports are generated from the session&apos;s immutable policy snapshot.
        They do not publish to the Employee Portal.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <a
          className="inline-flex min-h-11 items-center rounded-md border border-input px-4 py-2 text-sm font-semibold text-info hover:bg-accent"
          href={`/api/admin/exports/${encodedSessionId}/progress.csv`}
        >
          Download Bid progress (CSV)
        </a>
        <a
          className="inline-flex min-h-11 items-center rounded-md border border-input px-4 py-2 text-sm font-semibold text-info hover:bg-accent"
          href={`/api/admin/placements/export?session_id=${encodedSessionId}&format=csv`}
        >
          Download current awards / final results (CSV)
        </a>
      </div>
    </section>
  );
}
