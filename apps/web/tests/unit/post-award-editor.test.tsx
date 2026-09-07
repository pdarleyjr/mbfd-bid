// @vitest-environment jsdom
import { type PostAwardObligation, PostAwardObligationsSchema } from '@mbfd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useState } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { PostAwardObligationsEditor } from '../../components/admin/PostAwardObligationsEditor';
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root | undefined;
const client = new QueryClient();
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  client.clear();
  document.body.replaceChildren();
});
function Form() {
  const [terms, setTerms] = useState<PostAwardObligation[]>([
    {
      id: 'synthetic-term',
      credential: 'Synthetic training',
      sourceRef: 'Synthetic reviewed date authority',
      deadline: {
        basis: 'FINAL_POSITION_AWARD',
        unit: 'CALENDAR_MONTHS',
        count: 3,
        timeZone: 'America/New_York',
      },
    },
  ]);
  return (
    <>
      <PostAwardObligationsEditor value={terms} onChange={setTerms} />
      <output>{JSON.stringify(terms)}</output>
    </>
  );
}
it('requires an explicit approved start and retains it when the period changes', () => {
  client.setQueryData(['admin', 'credentials'], [{ id: 1, name: 'Synthetic training' }]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <QueryClientProvider client={client}>
        <Form />
      </QueryClientProvider>,
    ),
  );
  const control = (text: string) => {
    const label = [...container.querySelectorAll('label')].find((node) =>
      node.textContent?.trim().startsWith(text),
    );
    const field = label?.querySelector('input,select');
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement))
      throw new Error(`Missing ${text}`);
    return field;
  };
  const change = (text: string, value: string) =>
    act(() => {
      const field = control(text);
      const setter = Object.getOwnPropertyDescriptor(
        field instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLSelectElement.prototype,
        'value',
      )?.set;
      if (!setter) throw new Error('DOM setter unavailable');
      setter.call(field, value);
      field.dispatchEvent(new Event('change', { bubbles: true }));
      if (field instanceof HTMLInputElement)
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const value = () => JSON.parse(container.querySelector('output')?.textContent ?? 'null');
  change('Deadline starts from', 'APPROVED_BID_START_DATE');
  expect(control('Approved bid start date')).toHaveProperty('value', '');
  expect(PostAwardObligationsSchema.safeParse(value()).success).toBe(false);
  change('Approved bid start date', '2027-01-01');
  change('Calendar unit', 'CALENDAR_DAYS');
  expect(value()[0].deadline).toMatchObject({
    basis: 'APPROVED_BID_START_DATE',
    startOn: '2027-01-01',
    unit: 'CALENDAR_DAYS',
    count: 3,
  });
  expect(PostAwardObligationsSchema.safeParse(value()).success).toBe(true);
  change('Deadline starts from', 'FINAL_POSITION_AWARD');
  expect(value()[0].deadline).toEqual({
    basis: 'FINAL_POSITION_AWARD',
    unit: 'CALENDAR_DAYS',
    count: 3,
    timeZone: 'America/New_York',
  });
});
