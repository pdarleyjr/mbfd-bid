'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** One destination for workspace actions, including repeated clicks on the
 * current view. The caller waits for the URL commit and requested panel. */
export function useBidNavigation(
  rendered: string,
  loading: boolean,
  open: (view: string, section?: string) => void,
  initialDestination?: string,
) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [request, setRequest] = useState<{ destination: string; serial: number } | null>(
    initialDestination ? { destination: initialDestination, serial: 1 } : null,
  );
  const [announcement, setAnnouncement] = useState('');
  const navigate = useCallback(
    (view: string, section?: string) => {
      setAnnouncement('');
      open(view, section);
      setRequest((previous) => ({
        destination: section ? `${view}:${section}` : view,
        serial: (previous?.serial ?? 0) + 1,
      }));
    },
    [open],
  );
  useEffect(() => {
    if (!request || loading || request.destination !== rendered || !heading.current) return;
    // The admin shell resets its scroll container when a route commits. Wait
    // until all commit effects finish so that reset cannot undo this handoff.
    const frame = requestAnimationFrame(() => {
      const destination = heading.current;
      if (!destination) return;
      destination.scrollIntoView?.({ block: 'start', behavior: 'instant' });
      destination.focus({ preventScroll: true });
      setAnnouncement(`${destination.textContent} opened.`);
    });
    return () => cancelAnimationFrame(frame);
  }, [request, rendered, loading]);
  return { heading, navigate, announcement };
}
