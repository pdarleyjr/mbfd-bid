'use client';
export function AIDissentMarker({ aiAdvisoryId }: { aiAdvisoryId: string | null }) {
  if (!aiAdvisoryId) return null;
  return (
    <span
      data-testid={`audit-dissent-marker-${aiAdvisoryId}`}
      className="ml-2 inline-block text-xs bg-amber-200 text-amber-900 rounded px-1.5 py-0.5 font-medium"
    >
      AI dissent
    </span>
  );
}
