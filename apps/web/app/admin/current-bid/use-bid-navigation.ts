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
  const completed = useRef(0);
  const [request, setRequest] = useState<{
    destination: string;
    serial: number;
    initiator: Element | null;
  } | null>(
    initialDestination ? { destination: initialDestination, serial: 1, initiator: null } : null,
  );
  const [announcement, setAnnouncement] = useState('');
  const navigate = useCallback(
    (view: string, section?: string) => {
      setAnnouncement('');
      open(view, section);
      setRequest((previous) => ({
        destination: section ? `${view}:${section}` : view,
        serial: (previous?.serial ?? 0) + 1,
        initiator: document.activeElement,
      }));
    },
    [open],
  );
  useEffect(() => {
    if (
      !request ||
      completed.current === request.serial ||
      loading ||
      request.destination !== rendered ||
      !heading.current
    )
      return;
    // The admin shell resets its scroll container when a route commits. Wait
    // until all commit effects finish so that reset cannot undo this handoff.
    const frame = requestAnimationFrame(() => {
      const destination = heading.current;
      if (!destination) return;
      completed.current = request.serial;
      // A fast keyboard operator may already have moved to another control
      // while the URL committed. Do not steal that newer focus or its viewport.
      const active = document.activeElement;
      if (
        !active ||
        active === document.body ||
        active === request.initiator ||
        active === destination
      ) {
        destination.scrollIntoView?.({ block: 'start', behavior: 'instant' });
        destination.focus({ preventScroll: true });
      }
      setAnnouncement(`${destination.textContent} opened.`);
    });
    return () => cancelAnimationFrame(frame);
  }, [request, rendered, loading]);
  return { heading, navigate, announcement };
}
