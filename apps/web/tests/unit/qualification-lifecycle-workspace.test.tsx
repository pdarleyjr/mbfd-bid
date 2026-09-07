// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminQueryProvider } from '../../app/admin/_components/AdminQueryProvider';
import {
  QualificationLifecycleWorkspace as QualificationComponent,
  type QualificationCredential,
  type QualificationMember,
} from '../../app/admin/personnel/qualifications/QualificationLifecycleWorkspace';
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
function QualificationLifecycleWorkspace(
  props: React.ComponentProps<typeof QualificationComponent>,
) {
  return (
    <AdminQueryProvider>
      <QualificationComponent {...props} />
    </AdminQueryProvider>
  );
}

const members: QualificationMember[] = [
  {
    id: 7,
    employeeId: 'synthetic-007',
    firstName: 'Avery',
    lastName: 'Operator',
    rank: 'FF',
    employmentStatus: 'active',
  },
];

const credentials: QualificationCredential[] = [
  { id: 13, name: 'State Certified Paramedic', fyPointsDefault: 5 },
];

const lifecycleHistory = {
  memberId: 7,
  asOf: '2026-08-28',
  certifications: [
    {
      credentialId: 13,
      credentialName: 'State Certified Paramedic',
      status: 'active',
      effectiveOn: '2026-08-28',
      expiresOn: '2027-08-28',
      evidenceSource: 'State registry',
      evidenceReference: 'case-123',
      eventId: 'qualification-event-1',
      origin: 'lifecycle_evidence',
    },
  ],
  specialties: [
    {
      specialtyCode: 'TECHNICAL_RESCUE',
      status: 'active',
      effectiveOn: '2026-08-28',
      expiresOn: '2027-08-28',
      evidenceSource: 'Specialty board',
      evidenceReference: 'specialty-case-456',
      eventId: 'qualification-specialty-event-1',
    },
  ],
  events: [
    {
      id: 'qualification-event-1',
      memberId: 7,
      credentialId: 13,
      credentialName: 'State Certified Paramedic',
      specialtyCode: null,
      kind: 'CERTIFICATION_GAINED',
      effectiveOn: '2026-08-28',
      expiresOn: '2027-08-28',
      evidenceSource: 'State registry',
      evidenceReference: 'case-123',
      reason: 'Renewal documentation reviewed',
      actorSubject: 'admin:7',
      idempotencyKey: 'qualification-idempotency-key',
      beforeState: { v: 1 },
      afterState: { v: 1 },
      createdAt: '2026-08-28T00:00:00.000Z',
    },
  ],
};

const roots: Root[] = [];

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

beforeEach(() => {
  router.refresh.mockClear();
  vi.stubGlobal('crypto', { randomUUID: () => 'qualification-idempotency-key' });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function renderWorkspace() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <QualificationLifecycleWorkspace
        asOf="2026-08-28"
        members={members}
        credentials={credentials}
      />,
    );
  });
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function setControl(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  await act(async () => {
    const prototype =
      control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : control instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) throw new Error('Control setter is unavailable.');
    setter.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function requiredControl<T>(container: HTMLElement, testId: string): T {
  const control = container.querySelector(`[data-testid="${testId}"]`);
  if (!control) throw new Error(`Expected qualification lifecycle control ${testId}.`);
  return control as T;
}

function lifecycleFetchMock(
  onPost: (init: RequestInit | undefined) => void,
): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/auth/csrf')
      return new Response(JSON.stringify({ token: 'csrf_11111111-1111-1111-1111-111111111111' }), {
        status: 200,
      });
    if (url === '/api/admin/qualification-lifecycle/members/7?as_of=2026-08-28') {
      return new Response(JSON.stringify(lifecycleHistory), { status: 200 });
    }
    if (url === '/api/admin/qualification-lifecycle/events') {
      onPost(init);
      return new Response(
        JSON.stringify({ replayed: false, event: { id: 'qualification-event-1' } }),
        { status: 201 },
      );
    }
    return new Response(JSON.stringify({ error: 'unexpected_request' }), { status: 500 });
  });
}

describe('QualificationLifecycleWorkspace', () => {
  it('shows separate credential and specialty controls plus effective, expiration, status, and immutable history without a legacy direct toggle', () => {
    const html = renderToStaticMarkup(
      <QualificationLifecycleWorkspace
        asOf="2026-08-28"
        members={members}
        credentials={credentials}
      />,
    );

    expect(html).toContain('Qualification lifecycle');
    expect(html).toContain('Certification credential');
    expect(html).toContain('Specialty qualification code');
    expect(html).toContain('Effective date');
    expect(html).toContain('Expiration date');
    expect(html).toContain('Evidence source');
    expect(html).toContain('Evidence reference');
    expect(html).toContain('Current status');
    expect(html).toContain('Qualification history');
    expect(html).toContain('No legacy direct credential toggle is available.');
    expect(html).toContain('data-testid="qualification-event-form"');
  });

  it('retries the same certification request after response loss and displays the accepted projection', async () => {
    const attempts: RequestInit[] = [];
    const fetchMock = lifecycleFetchMock((init) => {
      attempts.push(init ?? {});
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('include');
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(
        'qualification-qualification-idempotency-key',
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        member_id: 7,
        credential_id: 13,
        kind: 'CERTIFICATION_GAINED',
        effective_on: '2026-08-28',
        expires_on: '2027-08-28',
        evidence_source: 'State registry',
        evidence_reference: 'case-123',
        reason: 'Renewal documentation reviewed',
      });
      if (attempts.length === 1) throw new TypeError('Synthetic qualification response loss');
    });
    vi.stubGlobal('fetch', fetchMock);

    const container = renderWorkspace();
    await settle();

    await setControl(
      requiredControl<HTMLInputElement>(container, 'qualification-expires-on'),
      '2027-08-28',
    );
    await setControl(
      requiredControl<HTMLInputElement>(container, 'qualification-source'),
      'State registry',
    );
    await setControl(
      requiredControl<HTMLInputElement>(container, 'qualification-evidence-reference'),
      'case-123',
    );
    await setControl(
      requiredControl<HTMLTextAreaElement>(container, 'qualification-reason'),
      'Renewal documentation reviewed',
    );
    await submit(requiredControl<HTMLFormElement>(container, 'qualification-event-form'));
    expect(container.textContent).toContain('Synthetic qualification response loss');
    expect(router.refresh).not.toHaveBeenCalled();
    await submit(requiredControl<HTMLFormElement>(container, 'qualification-event-form'));
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.body).toBe(attempts[1]?.body);
    expect(new Headers(attempts[0]?.headers).get('Idempotency-Key')).toBe(
      new Headers(attempts[1]?.headers).get('Idempotency-Key'),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/qualification-lifecycle/events',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(router.refresh).toHaveBeenCalled();
    expect(container.textContent).toContain('qualification-event-1');
    expect(container.textContent).toContain('State Certified Paramedic');
    expect(container.textContent).toContain('TECHNICAL_RESCUE');
    expect(container.textContent).toContain('Certification status');
    expect(container.textContent).toContain('Specialty qualification status');
    expect(container.textContent).not.toContain('Qualification lifecycle backend unavailable');
  });

  it('sends a specialty qualification separately from credentials to the mounted contract', async () => {
    const fetchMock = lifecycleFetchMock((init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        member_id: 7,
        specialty_code: 'TECHNICAL_RESCUE',
        kind: 'SPECIALTY_QUALIFIED',
        effective_on: '2026-08-28',
        expires_on: '2027-08-28',
        evidence_source: 'Specialty board',
        evidence_reference: 'specialty-case-456',
        reason: 'Technical rescue qualification reviewed',
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const container = renderWorkspace();
    await settle();

    await setControl(
      requiredControl<HTMLSelectElement>(container, 'qualification-kind'),
      'SPECIALTY_QUALIFIED',
    );
    await setControl(
      requiredControl<HTMLInputElement>(container, 'qualification-specialty-code'),
      'TECHNICAL_RESCUE',
    );
    await setControl(
      requiredControl<HTMLInputElement>(container, 'qualification-expires-on'),
      '2027-08-28',
    );
    await setControl(
      requiredControl<HTMLInputElement>(container, 'qualification-source'),
      'Specialty board',
    );
    await setControl(
      requiredControl<HTMLInputElement>(container, 'qualification-evidence-reference'),
      'specialty-case-456',
    );
    await setControl(
      requiredControl<HTMLTextAreaElement>(container, 'qualification-reason'),
      'Technical rescue qualification reviewed',
    );
    await submit(requiredControl<HTMLFormElement>(container, 'qualification-event-form'));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/qualification-lifecycle/events',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('represents specialty revocation as its own terminal event and does not send an expiration date', async () => {
    const fetchMock = lifecycleFetchMock((init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        member_id: 7,
        specialty_code: 'TECHNICAL_RESCUE',
        kind: 'SPECIALTY_REVOKED',
        effective_on: '2026-08-28',
        evidence_source: 'Specialty board',
        evidence_reference: 'specialty-revocation-456',
        reason: 'Technical rescue revocation reviewed',
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const container = renderWorkspace();
    await settle();

    await setControl(
      requiredControl<HTMLSelectElement>(container, 'qualification-kind'),
      'SPECIALTY_REVOKED',
    );
    await setControl(
      requiredControl<HTMLInputElement>(container, 'qualification-specialty-code'),
      'TECHNICAL_RESCUE',
    );
    await setControl(
      requiredControl<HTMLInputElement>(container, 'qualification-source'),
      'Specialty board',
    );
    await setControl(
      requiredControl<HTMLInputElement>(container, 'qualification-evidence-reference'),
      'specialty-revocation-456',
    );
    await setControl(
      requiredControl<HTMLTextAreaElement>(container, 'qualification-reason'),
      'Technical rescue revocation reviewed',
    );
    await submit(requiredControl<HTMLFormElement>(container, 'qualification-event-form'));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/qualification-lifecycle/events',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(container.textContent).toContain('Specialty revoked');
  });

  it('labels an unavailable mounted lifecycle endpoint as fail-closed and never infers a qualification status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })),
    );

    const container = renderWorkspace();
    await settle();

    expect(container.textContent).toContain('Qualification lifecycle backend unavailable');
    expect(container.textContent).toContain('No qualification status or history was inferred.');
    expect(container.textContent).toContain(
      '/api/admin/qualification-lifecycle/members/7?as_of=2026-08-28',
    );
  });
});
