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
    <section>
      <h2>Direct CSV downloads</h2>
      <p>
        Progress and award exports are generated from the session&apos;s immutable policy snapshot.
        They do not publish to the Employee Portal.
      </p>
      <div className="grid">
        <a href={`/api/admin/exports/${encodedSessionId}/progress.csv`}>
          Download Bid progress (CSV)
        </a>
        <a href={`/api/admin/placements/export?session_id=${encodedSessionId}&format=csv`}>
          Download current awards / final results (CSV)
        </a>
      </div>
    </section>
  );
}
