// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUnsavedChanges } from '../../lib/use-unsaved-changes';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root | undefined;
function Form({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty, 'annual policy changes');
  return <a href="/admin/annual-policy?year=2089">Next year</a>;
}
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function mount() {
  window.history.replaceState(null, '', '/admin/annual-policy?year=2088');
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<Form dirty />));
  return container.querySelector('a') as HTMLAnchorElement;
}
function dispatch(link: HTMLAnchorElement, options: MouseEventInit = {}) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });
  // Prevent jsdom's unsupported navigation after observing the capture guard.
  let guarded = false;
  link.addEventListener(
    'click',
    () => {
      guarded = event.defaultPrevented;
      event.preventDefault();
    },
    { once: true },
  );
  link.dispatchEvent(event);
  return guarded || event.cancelBubble;
}
describe('unsaved annual edits', () => {
  it('asks before changing only the year and permits explicit discard', () => {
    const link = mount();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const refused = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(refused);
    expect(refused.defaultPrevented).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      'Discard unsaved annual policy changes and leave this page?',
    );
    confirm.mockReturnValue(true);
    expect(dispatch(link)).toBe(false);
  });
  it('does not block anchors, downloads, or opening a separate tab', () => {
    const link = mount();
    const confirm = vi.spyOn(window, 'confirm');
    link.href = '/admin/annual-policy?year=2088#specialties';
    dispatch(link);
    link.href = '/admin/annual-policy?year=2089';
    dispatch(link, { ctrlKey: true });
    link.setAttribute('download', 'policy.json');
    dispatch(link);
    expect(confirm).not.toHaveBeenCalled();
  });
  it('removes the guard after a successful save', () => {
    const link = mount();
    const confirm = vi.spyOn(window, 'confirm');
    act(() => root?.render(<Form dirty={false} />));
    dispatch(link);
    expect(confirm).not.toHaveBeenCalled();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });
});
