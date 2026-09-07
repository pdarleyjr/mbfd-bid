'use client';
import { useEffect } from 'react';

type HistoryNavigationEvent = Event & {
  navigationType: string;
  destination: { url: string; sameDocument: boolean };
};

/** Protect local form state without interfering with background query refresh. */
export function useUnsavedChanges(dirty: boolean, description = 'edits') {
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const navigate = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === '_blank' ||
        link.hasAttribute('download') ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const destination = new URL(link.href);
      if (
        destination.origin === window.location.origin &&
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      )
        return;
      if (!window.confirm(`Discard unsaved ${description} and leave this page?`)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Cancel supported same-document history traversals before Next restores
    // another page. Do not rewrite history entries or interfere with its state.
    // https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-navigate-event
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const traverse = (raw: Event) => {
      const event = raw as HistoryNavigationEvent;
      if (
        event.navigationType !== 'traverse' ||
        !event.cancelable ||
        !event.destination.sameDocument
      )
        return;
      const target = new URL(event.destination.url);
      if (target.pathname === window.location.pathname && target.search === window.location.search)
        return;
      if (!window.confirm(`Discard unsaved ${description} and leave this page?`))
        event.preventDefault();
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate, true);
    navigation?.addEventListener('navigate', traverse);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', navigate, true);
      navigation?.removeEventListener('navigate', traverse);
    };
  }, [dirty, description]);
}
