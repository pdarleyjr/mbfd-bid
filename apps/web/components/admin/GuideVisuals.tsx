import { guideVisualsFor } from '@/app/admin/guide/guide-visuals';
import Image from 'next/image';

/** Production captures are cropped and redacted before they enter public assets. */
export function GuideVisuals({ topicId }: { topicId: string }) {
  const visuals = guideVisualsFor(topicId);
  if (!visuals.length) return null;

  return (
    <div className="mt-4 grid gap-4" aria-label="Visual instructions">
      {visuals.map((visual) => (
        <figure key={visual.src} className="rounded-lg border border-border bg-card p-3">
          <div className="overflow-hidden rounded border border-border bg-muted">
            <Image
              src={visual.src}
              alt={visual.alt}
              width={1280}
              height={720}
              className="h-auto w-full object-contain"
              unoptimized
            />
          </div>
          <figcaption className="mt-2 text-sm font-semibold text-foreground">
            {visual.caption}
          </figcaption>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-5 text-foreground">
            {visual.markers.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            Pre-cutoff production reference · release 0c360901. Confirm current state before acting.
          </p>
        </figure>
      ))}
    </div>
  );
}
