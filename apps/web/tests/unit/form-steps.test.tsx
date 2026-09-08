// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { FormSteps } from '../../components/admin/FormSteps';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root;
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});
it('retains entries and reveals the first invalid section without jumping to later errors', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <form>
        <FormSteps labels={['Scope', 'Evidence', 'Rules']}>
          <input aria-label="Scope" defaultValue="Preserved scope" />
          <input aria-label="Evidence" required />
          <input aria-label="Rules" required />
        </FormSteps>
      </form>,
    ),
  );
  const inputs = container.querySelectorAll('input');
  await act(async () => {
    container.querySelector('form')?.checkValidity();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(inputs[1]?.closest('[data-form-step]')?.hasAttribute('hidden')).toBe(false);
  expect(inputs[2]?.closest('[data-form-step]')?.hasAttribute('hidden')).toBe(true);
  expect(document.activeElement).toBe(inputs[1]);
  expect(inputs[0]?.value).toBe('Preserved scope');
  await act(async () => {
    container.querySelector('form')?.checkValidity();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(document.activeElement).toBe(inputs[1]);
  const toggle = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Show all sections',
  );
  act(() => toggle?.click());
  expect(container.querySelectorAll('[data-form-step][hidden]')).toHaveLength(0);
  act(() => toggle?.click());
  expect(container.querySelectorAll('[data-form-step][hidden]')).toHaveLength(2);
});
