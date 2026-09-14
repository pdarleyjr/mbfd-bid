// @vitest-environment jsdom
import type { DepartmentPerson } from '@mbfd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useState } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FocusedMemberCallbacks,
  MemberInteractionState,
} from '../../app/admin/personnel/focused-member';

const mocks = vi.hoisted(() => ({
  callbacks: null as FocusedMemberCallbacks | null,
  submitted: vi.fn(),
  closed: vi.fn(),
}));
vi.mock('../../app/admin/personnel/PersonnelWorkspace', () => ({
  PersonnelWorkspace: (props: FocusedMemberCallbacks) => (
    <StubLifecycle {...props} name="personnel" />
  ),
}));
vi.mock('../../app/admin/personnel/qualifications/QualificationLifecycleWorkspace', () => ({
  QualificationLifecycleWorkspace: (props: FocusedMemberCallbacks) => (
    <StubLifecycle {...props} name="qualification" />
  ),
}));
vi.mock('../../app/admin/department/people/people-api', () => ({
  readCredentialCatalog: vi.fn(async () => []),
}));

import { AddMemberPanel } from '../../app/admin/department/people/AddMemberPanel';
import { UpdateMemberPanel } from '../../app/admin/department/people/UpdateMemberPanel';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const person: DepartmentPerson = {
  id: 981001,
  employeeId: 'SYNTHETIC-PANEL-001',
  firstName: 'Synthetic',
  lastName: 'Panel Member',
  rank: 'LT',
  personnelClassification: 'SWORN',
  employmentStatus: 'active',
  employmentStatusEffectiveOn: '2026-08-01',
  separationType: null,
  hasAssignment: false,
  assignments: [],
  serviceRecord: {
    basis: 'current_member_record',
    rscSeniority: null,
    rankSeniority: null,
    hiredAt: null,
    promotedAt: null,
  },
};
function StubLifecycle(props: FocusedMemberCallbacks & { name: string }) {
  mocks.callbacks = props;
  return (
    <form data-testid={`${props.name}-stub`} onSubmit={(event) => event.preventDefault()}>
      <label>
        Draft value
        <input
          onChange={() =>
            props.onInteractionState?.({ dirty: true, busy: false, uncertain: false })
          }
        />
      </label>
      <button
        type="button"
        onClick={() => {
          mocks.submitted();
          props.onInteractionState?.({ dirty: true, busy: true, uncertain: false });
        }}
      >
        Submit child request
      </button>
    </form>
  );
}
let root: Root | undefined;
let client: QueryClient;
beforeEach(() => {
  mocks.callbacks = null;
  mocks.submitted.mockClear();
  mocks.closed.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  client?.clear();
  document.body.replaceChildren();
});
async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(kind: 'add' | 'update') {
  function Harness() {
    const [open, setOpen] = useState(true);
    const close = () => {
      mocks.closed();
      setOpen(false);
    };
    return open ? (
      kind === 'add' ? (
        <AddMemberPanel asOf="2026-09-12" onClose={close} />
      ) : (
        <UpdateMemberPanel person={person} asOf="2026-09-12" onClose={close} />
      )
    ) : null;
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await settle(() =>
    root?.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
}
function button(label: string) {
  const control = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (entry) => (entry.getAttribute('aria-label') ?? entry.textContent?.trim()) === label,
  );
  if (!control) throw new Error(`Button missing: ${label}`);
  return control;
}
async function state(next: MemberInteractionState) {
  await settle(() => mocks.callbacks?.onInteractionState?.(next));
}
async function draftThenClose() {
  await state({ dirty: true, busy: false, uncertain: false });
  await settle(() => button('Close panel').click());
}

describe('Department member panel close guards', () => {
  for (const kind of ['add', 'update'] as const) {
    it(`${kind}: the discard prompt blocks the child form, and Keep editing and ordinary discard work`, async () => {
      await mount(kind);
      await draftThenClose();
      expect(document.querySelector<HTMLInputElement>('form input')?.matches(':disabled')).toBe(
        true,
      );
      expect(button('Submit child request').matches(':disabled')).toBe(true);
      await settle(() => button('Submit child request').click());
      expect(mocks.submitted).not.toHaveBeenCalled();
      await settle(() => button('Keep editing').click());
      expect(document.querySelector<HTMLInputElement>('form input')?.matches(':disabled')).toBe(
        false,
      );
      expect(mocks.closed).not.toHaveBeenCalled();
      await settle(() => button('Close panel').click());
      await settle(() => button('Discard changes').click());
      expect(mocks.closed).toHaveBeenCalledTimes(1);
      expect(document.querySelector('form')).toBeNull();
    });
    for (const phase of ['busy', 'uncertain'] as const) {
      it(`${kind}: an asynchronous ${phase} callback prevents an open discard prompt from unmounting the request owner`, async () => {
        await mount(kind);
        await draftThenClose();
        await state({ dirty: true, busy: phase === 'busy', uncertain: phase === 'uncertain' });
        expect(button('Discard changes').matches(':disabled')).toBe(true);
        await settle(() => button('Discard changes').click());
        await settle(() => button('Close panel').click());
        expect(mocks.closed).not.toHaveBeenCalled();
        expect(document.querySelector('[data-testid="personnel-stub"]')).not.toBeNull();
        await settle(() => button('Keep editing').click());
        await settle(() => mocks.callbacks?.onAccepted?.());
        expect(mocks.closed).toHaveBeenCalledTimes(1);
        expect(document.querySelector('form')).toBeNull();
      });
    }
  }
  it('a dirty branch switch needs explicit discard and cannot submit from the abandoned branch', async () => {
    await mount('update');
    await state({ dirty: true, busy: false, uncertain: false });
    await settle(() => button('Credential change').click());
    expect(button('Submit child request').matches(':disabled')).toBe(true);
    expect(button('Employment or assignment').matches(':disabled')).toBe(true);
    await settle(() => button('Discard changes').click());
    await vi.waitFor(async () => {
      await settle();
      expect(document.querySelector('[data-testid="qualification-stub"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-testid="personnel-stub"]')).toBeNull();
    expect(mocks.submitted).not.toHaveBeenCalled();
    expect(mocks.closed).not.toHaveBeenCalled();
  });
});
