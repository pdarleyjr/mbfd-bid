// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { AdministratorGuideWorkspace } from '../../app/admin/guide/AdministratorGuideWorkspace';
import AdministratorGuidePage from '../../app/admin/guide/page';

const roots: Root[] = [];

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

function renderGuide(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(<AdministratorGuideWorkspace />);
  });
  return container;
}

async function click(control: HTMLElement) {
  await act(async () => {
    control.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('Administrator Guide workspace', () => {
  it('renders the protected guide route content with category navigation', () => {
    const html = renderToStaticMarkup(<AdministratorGuidePage />);
    expect(html).toContain('Administrator Guide');
    expect(html).toContain('Browse by task');
    expect(html).toContain('Search the Administrator Guide');
    expect(html).toContain('href="#telestaff"');
  });

  it('filters guide topics and expands the selected procedure from keyboard-friendly controls', async () => {
    const container = renderGuide();
    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error('Guide search did not render.');

    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(search, 'hold presentation');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('Live Presentation');
    expect(container.textContent).not.toContain('TeleStaff is a controlled reconciliation');

    const details = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Show how to use it',
    );
    if (!details) throw new Error('Collapsed guide control did not render.');
    await click(details);
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain(
      'HOLD DISPLAY is not the same as pausing Bid execution',
    );

    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(search, '');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const category = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Year-round staffing'),
    );
    if (!category) throw new Error('Category card did not render.');
    await click(category);
    expect(container.textContent).toContain('Current Rosters');
    expect(container.textContent).not.toContain('Live Presentation');
  });
});
