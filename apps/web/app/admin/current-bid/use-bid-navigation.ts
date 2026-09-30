'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** One destination for workspace actions, including repeated clicks on the
 * current view. Focus/scroll happen after React installs the requested panel. */
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
    const destination = heading.current;
    destination.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    destination.focus({ preventScroll: true });
    setAnnouncement(`${destination.textContent} opened.`);
  }, [request, rendered, loading]);
  return { heading, navigate, announcement };
}
