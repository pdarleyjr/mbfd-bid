// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersonnelLifecyclePlan } from '../../../worker/src/lib/personnel-lifecycle';
import { planPersonnelLifecycleChange } from '../../../worker/src/lib/personnel-lifecycle';
import { PersonnelWorkspace } from '../../app/admin/personnel/PersonnelWorkspace';
import type { MemberInteractionState } from '../../app/admin/personnel/focused-member';
import { PersonnelPreview } from '../../app/admin/personnel/focused-member';
import { QualificationLifecycleWorkspace } from '../../app/admin/personnel/qualifications/QualificationLifecycleWorkspace';

const refresh = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/admin-projection-refresh', () => ({ usePersonnelProjectionRefresh: () => refresh }));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const roots: Root[] = [];
afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

const member = {
  id: 981001,
  employeeId: 'SYNTHETIC-981001',
  firstName: 'Synthetic',
  lastName: 'Member',
  rank: 'LT',
  employmentStatus: 'active' as const,
  employmentStatusEffectiveOn: '2026-08-01',
  separationType: null,
};
const date = '2026-09-12';
const targetProjection = (asOf: string, suffix = 'one') => ({
  asOf,
  updatedAt: 1789223400000,
  summary: { totalPositions: 1, occupiedPositions: 0, vacantPositions: 1 },
  unassignedMembers: [],
  positions: [
    {
      id: `synthetic-position-${suffix}`,
      stableSlotKey: `synthetic-position-${suffix}`,
      shift: 'E',
      station: 'Synthetic Station',
      unit: `Synthetic Rescue ${suffix}`,
      positionName: 'Training Lieutenant',
      applicableRank: 'LT',
      division: 'Synthetic Operations',
      reviewStatus: 'approved' as const,
      occupancy: 'vacant' as const,
      temporaryContext: [],
      assignment: null,
      member: null,
    },
  ],
});
const personnelPreview = {
  preview: true,
  current: {
    member: {
      ...member,
      personnelClassification: 'SWORN',
      bidCategory: 'OFC',
      rscSeniority: 518,
      rankSeniority: 12,
      hiredAt: '2010-05-01',
      promotedAt: '2023-02-01',
      isProbationary: false,
      createdAt: 1789223400000,
      updatedAt: 1789223400000,
    },
    assignments: [],
  },
  proposed: {
    ok: true,
    memberProjection: null,
    assignmentClosures: [],
    assignmentCreation: {
      id: null,
      memberId: member.id,
      staffingPositionId: 'synthetic-position-one',
      originType: 'ADMIN_TRANSFER',
      originRef: 'preview-only',
      status: 'active',
      effectiveFrom: date,
    },
    event: {
      kind: 'TRANSFER',
      effectiveOn: date,
      employmentStatusBefore: 'active',
      employmentStatusAfter: 'active',
      rankBefore: 'LT',
      rankAfter: 'LT',
      separationType: null,
      reason: 'Synthetic reviewed transfer',
      origin: 'ADMIN',
      actorSubject: 'synthetic-reviewer',
      idempotencyKey: 'preview-only',
      supersedesEventId: null,
      beforeState: {
        memberId: member.id,
        employmentStatus: 'active',
        employmentStatusEffectiveOn: '2026-08-01',
        separationType: null,
        rank: 'LT',
        assignment: null,
      },
      afterState: {
        memberId: member.id,
        employmentStatus: 'active',
        separationType: null,
        rank: 'LT',
        staffingPositionId: 'synthetic-position-one',
        assignment: {
          staffingPositionId: 'synthetic-position-one',
          effectiveFrom: date,
          status: 'active',
        },
      },
    },
  } satisfies PersonnelLifecyclePlan,
  vacancyImpact: 'KNOWN_VACANT',
  qualificationImpact: 'NOT_DETERMINED_BY_PERSONNEL_PREVIEW',
  establishedBidSnapshotImpact: 'NONE',
};
const credentialPreview = {
  ok: true,
  sourceRevision: 10,
  scope:
    'Eligibility, points and candidate priority at each configured qualification date. Specialty procedure, choices, capacity and actual awards still require annual review and practice. Saving current evidence does not change approved session snapshots or historical awards.',
  results: [
    { year: 2027, available: false, reason: 'qualification_evaluation_date_required' },
    {
      year: 2028,
      available: true,
      evaluationOn: date,
      otherPriorityChanges: 0,
      changes: [
        {
          positionId: 'synthetic-position-one',
          memberId: member.id,
          before: {
            eligible: false,
            points: 0,
            soPoints: 0,
            moPoints: 0,
            priority: null,
            reasons: ['Synthetic credential requirement'],
          },
          after: { eligible: true, points: 2, soPoints: 0, moPoints: 0, priority: 1, reasons: [] },
        },
      ],
    },
  ],
};

async function render(node: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return container;
}
function form(container: HTMLElement, id: string) {
  const value = container.querySelector<HTMLFormElement>(`[data-testid="${id}"]`);
  if (!value) throw new Error(`Missing form ${id}`);
  return value;
}
function field(container: HTMLElement, label: string) {
  const value = [...container.querySelectorAll('label')]
    .find((node) => node.textContent?.includes(label))
    ?.querySelector('input,select,textarea');
  if (!value) throw new Error(`Missing field ${label}`);
  return value as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
}
async function fill(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      control instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : control instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function submit(target: HTMLFormElement, preview = false) {
  const submitter = preview
    ? target.querySelector<HTMLButtonElement>('button[value="preview"]')
    : target.querySelector<HTMLButtonElement>('button[type="submit"]:not([value="preview"])');
  await act(async () => {
    target.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter }));
  });
}
function receipt(init?: RequestInit) {
  const body = JSON.parse(String(init?.body));
  return Response.json({
    replayed: true,
    event: {
      id: 'synthetic-accepted-event',
      memberId: body.member_id ?? 981519,
      kind: body.kind,
      effectiveOn: body.effective_on,
      idempotencyKey: new Headers(init?.headers).get('Idempotency-Key'),
    },
  });
}
const csrf = () => Response.json({ token: 'csrf_11111111-1111-1111-1111-111111111111' });

describe('focused member lifecycle forms', () => {
  for (const correction of [
    {
      field: 'Corrected employment state',
      value: 'active',
      payloadField: 'employment_status_after',
      omittedField: 'rank_after',
      expectedRank: 'LT',
      expectedStatus: 'active',
    },
    {
      field: 'Rank after change',
      value: 'CPT',
      payloadField: 'rank_after',
      omittedField: 'employment_status_after',
      expectedRank: 'CPT',
      expectedStatus: 'inactive',
    },
  ] as const) {
    it(`corrects only the explicitly chosen ${correction.field} and preserves that intention across date and kind edits`, async () => {
      const currentMember = {
        ...member,
        rank: 'LT' as const,
        employmentStatus: 'inactive' as const,
      };
      const previews: Record<string, unknown>[] = [];
      const commits: Record<string, unknown>[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = String(input);
          if (path === '/api/auth/csrf') return csrf();
          if (path.includes('current-roster')) {
            const asOf = new URL(path, 'http://localhost').searchParams.get('as_of') ?? '';
            return Response.json(targetProjection(asOf));
          }
          const body = JSON.parse(String(init?.body));
          if (path.endsWith('/preview')) {
            previews.push(body);
            // The canonical planner provides the route's proposed object. Expectations below
            // independently pin which optional field the UI sends and which source value survives.
            const proposed = planPersonnelLifecycleChange({
              kind: 'CORRECTION',
              effectiveOn: body.effective_on,
              reason: body.reason,
              member: currentMember,
              activeAssignments: [],
              nowOn: date,
              actorSubject: 'synthetic-reviewer',
              idempotencyKey: 'preview-only',
              eventId: 'preview-only',
              ...(body.rank_after ? { rankAfter: body.rank_after } : {}),
              ...(body.employment_status_after
                ? { employmentStatusAfter: body.employment_status_after }
                : {}),
            });
            if (!proposed.ok)
              throw new Error(`Canonical correction fixture rejected: ${proposed.error}`);
            return Response.json({
              preview: true,
              current: {
                member: { ...personnelPreview.current.member, ...currentMember },
                assignments: [],
              },
              proposed,
              vacancyImpact: 'NOT_DETERMINED_BY_PERSONNEL_PREVIEW',
              qualificationImpact: 'NOT_DETERMINED_BY_PERSONNEL_PREVIEW',
              establishedBidSnapshotImpact: 'NONE',
            });
          }
          if (path === '/api/admin/personnel/changes') {
            commits.push(body);
            return receipt(init);
          }
          throw new Error(`Unplanned route ${path}`);
        }),
      );
      const container = await render(
        <PersonnelWorkspace
          focusedMember
          summary={{ asOf: date }}
          members={[currentMember]}
          memberIdHint={member.id}
        />,
      );
      await fill(field(container, 'Change type'), 'CORRECTION');
      await fill(field(container, 'Operator reason'), 'Synthetic reviewed single-field correction');
      const targetForm = form(container, 'personnel-change-form');
      expect(field(container, 'Rank after change').value).toBe('UNCHANGED');
      expect(field(container, 'Corrected employment state').value).toBe('UNCHANGED');
      expect(targetForm.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
        true,
      );
      await submit(targetForm);
      expect(previews).toHaveLength(0);
      expect(commits).toHaveLength(0);
      expect(container.textContent).toContain('Choose a rank or employment status to correct');
      await fill(field(container, correction.field), correction.value);
      await submit(targetForm);
      expect(previews).toHaveLength(1);
      const panel = container.querySelector('[aria-label="Personnel change preview"]');
      const after = [...(panel?.querySelectorAll('section') ?? [])].find(
        (section) => section.querySelector('h4')?.textContent === 'Proposed',
      );
      expect(after?.textContent).toContain(`Rank${correction.expectedRank}`);
      expect(after?.textContent).toContain(`Employment status${correction.expectedStatus}`);
      await fill(field(container, 'Effective date'), '2026-10-01');
      expect(container.querySelector('[aria-label="Personnel change preview"]')).toBeNull();
      expect(field(container, correction.field).value).toBe(correction.value);
      await fill(field(container, 'Change type'), 'PROMOTION');
      await fill(field(container, 'Change type'), 'CORRECTION');
      expect(field(container, correction.field).value).toBe(correction.value);
      await submit(targetForm);
      await submit(targetForm);
      expect(previews).toHaveLength(2);
      expect(commits).toEqual([
        {
          kind: 'CORRECTION',
          member_id: member.id,
          effective_on: '2026-10-01',
          reason: 'Synthetic reviewed single-field correction',
          [correction.payloadField]: correction.value,
        },
      ]);
      expect(commits[0]).not.toHaveProperty(correction.omittedField);
      expect(previews[1]).toEqual(commits[0]);
    });
  }

  it('presents the actual lifecycle plan fields and named assignment changes without exposing request internals', async () => {
    const preview = structuredClone(personnelPreview);
    const priorAssignment = {
      id: 'synthetic-prior-assignment',
      memberId: member.id,
      staffingPositionId: 'synthetic-position-one',
      status: 'active',
      effectiveFrom: '2026-08-01',
      effectiveTo: null,
    };
    const proposed: PersonnelLifecyclePlan = {
      ...preview.proposed,
      memberProjection: { rank: 'CPT', promotedAt: date },
      assignmentClosures: [
        { id: 'synthetic-prior-assignment', status: 'ended', effectiveTo: '2026-09-11' },
      ],
      event: {
        ...preview.proposed.event,
        kind: 'PROMOTION',
        rankAfter: 'CPT',
        reason: 'Synthetic reviewed promotion',
        beforeState: {
          ...preview.proposed.event.beforeState,
          assignment: {
            id: priorAssignment.id,
            staffingPositionId: priorAssignment.staffingPositionId,
            status: priorAssignment.status,
            effectiveFrom: priorAssignment.effectiveFrom,
            effectiveTo: priorAssignment.effectiveTo,
          },
        },
        afterState: { ...preview.proposed.event.afterState, rank: 'CPT' },
      },
      assignmentCreation: { ...preview.proposed.assignmentCreation, originType: 'PROMOTION' },
    };
    const container = await render(
      <PersonnelPreview
        preview={{
          ...preview,
          current: { ...preview.current, assignments: [priorAssignment] },
          proposed,
        }}
        positions={targetProjection(date).positions}
      />,
    );
    const sections = [...container.querySelectorAll('section')];
    const current = sections.find(
      (section) => section.querySelector('h4')?.textContent === 'Current',
    );
    const after = sections.find(
      (section) => section.querySelector('h4')?.textContent === 'Proposed',
    );
    expect(current?.textContent).toContain('RankLT');
    expect(after?.textContent).toContain('RankCPT');
    expect(container.textContent).toContain('PROMOTION · Effective 2026-09-12');
    expect(container.textContent).toContain('Synthetic reviewed promotion');
    expect(
      container.querySelector('[aria-label="Proposed assignment changes"]')?.textContent,
    ).toContain(
      'End E shift · Synthetic Station · Synthetic Rescue one · Training Lieutenant after 2026-09-11.',
    );
    expect(
      container.querySelector('[aria-label="Proposed assignment changes"]')?.textContent,
    ).toContain(
      'Assign E shift · Synthetic Station · Synthetic Rescue one · Training Lieutenant from 2026-09-12 · active.',
    );
    expect(container.textContent).not.toContain('preview-only');
    expect(container.textContent).not.toContain('synthetic-reviewer');
    expect(container.textContent).not.toContain('idempotency');
  });
  it('reviews real new-member fields locally, invalidates edits, and retains a failed new-hire request', async () => {
    const states: MemberInteractionState[] = [];
    const accepted = vi.fn();
    const writes: RequestInit[] = [];
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        paths.push(path);
        if (path === '/api/auth/csrf') return csrf();
        if (path.includes('current-roster')) return Response.json(targetProjection(date));
        if (path === '/api/admin/personnel/changes' && init) {
          writes.push(init);
          if (writes.length === 1)
            return Response.json({ error: 'employee_id_exists' }, { status: 422 });
          if (writes.length === 2) throw new TypeError('Synthetic new-hire receipt lost');
          return receipt(init);
        }
        throw new Error(`Unplanned route ${path}`);
      }),
    );
    const container = await render(
      <PersonnelWorkspace
        focusedNewHire
        summary={{ asOf: date }}
        members={[]}
        onInteractionState={(state) => states.push(state)}
        onAccepted={accepted}
      />,
    );
    expect(container.textContent).toContain('Add member');
    expect(container.textContent).not.toContain('Change type');
    expect(container.textContent).not.toContain('Personnel health');
    expect(container.querySelector('[data-testid="temporary-overlay-form"]')).toBeNull();
    await fill(field(container, 'Employee ID'), 'SYNTHETIC_NEW_001');
    await fill(field(container, 'First name'), 'Synthetic Avery');
    await fill(field(container, 'Last name'), 'Rivera');
    await fill(field(container, 'RSC seniority'), '518');
    await fill(field(container, 'Operator reason'), 'Synthetic reviewed onboarding record');
    const targetForm = form(container, 'personnel-change-form');
    await submit(targetForm);
    expect(writes).toHaveLength(0);
    expect(paths.some((path) => path.endsWith('/preview'))).toBe(false);
    expect(container.querySelector('[aria-label="Entered member details"]')?.textContent).toContain(
      'SYNTHETIC_NEW_001',
    );
    expect(container.textContent).toContain('server will validate this request when you confirm');
    await submit(targetForm);
    expect(writes).toHaveLength(1);
    expect(states.at(-1)).toEqual({ dirty: true, busy: false, uncertain: false });
    expect(accepted).not.toHaveBeenCalled();
    await fill(field(container, 'Employee ID'), 'SYNTHETIC_NEW_002');
    expect(container.querySelector('[aria-label="Entered member details"]')).toBeNull();
    await submit(targetForm);
    await submit(targetForm);
    expect(writes).toHaveLength(2);
    expect(states.at(-1)?.uncertain).toBe(true);
    expect(targetForm.querySelector('fieldset')?.disabled).toBe(true);
    await submit(targetForm);
    expect(writes).toHaveLength(3);
    expect(writes[1]?.body).toBe(writes[2]?.body);
    expect(new Headers(writes[1]?.headers).get('Idempotency-Key')).toBe(
      new Headers(writes[2]?.headers).get('Idempotency-Key'),
    );
    expect(new Headers(writes[0]?.headers).get('Idempotency-Key')).not.toBe(
      new Headers(writes[1]?.headers).get('Idempotency-Key'),
    );
    expect(JSON.parse(String(writes[2]?.body))).toEqual({
      kind: 'NEW_HIRE',
      effective_on: date,
      reason: 'Synthetic reviewed onboarding record',
      new_member: {
        employee_id: 'SYNTHETIC_NEW_002',
        first_name: 'Synthetic Avery',
        last_name: 'Rivera',
        rank: 'FF',
        bid_category: 'FF',
        rsc_seniority: 518,
      },
      rank_after: 'FF',
    });
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toEqual({ dirty: false, busy: false, uncertain: false });
  });

  it('does not manufacture a fire rank or seniority for an excluded civilian new member', async () => {
    const writes: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === '/api/auth/csrf') return csrf();
        if (path.includes('current-roster')) return Response.json(targetProjection(date));
        if (path === '/api/admin/personnel/changes' && init) {
          writes.push(init);
          return receipt(init);
        }
        throw new Error(`Unplanned route ${path}`);
      }),
    );
    const container = await render(
      <PersonnelWorkspace focusedNewHire summary={{ asOf: date }} members={[]} />,
    );
    await fill(field(container, 'Employee ID'), 'SYNTHETIC_CIVILIAN_001');
    await fill(field(container, 'First name'), 'Synthetic Jordan');
    await fill(field(container, 'Last name'), 'Patel');
    await fill(field(container, 'Rank after change'), 'CIVILIAN');
    await fill(field(container, 'Operator reason'), 'Synthetic reviewed civilian record');
    await submit(form(container, 'personnel-change-form'));
    await submit(form(container, 'personnel-change-form'));
    const payload = JSON.parse(String(writes[0]?.body));
    expect(payload.new_member.rank).toBeNull();
    expect(payload.new_member.bid_category).toBe('EXCLUDED');
    expect(payload.new_member).not.toHaveProperty('rsc_seniority');
    expect(payload).not.toHaveProperty('rank_after');
  });

  it('reports dirty new-member review to the parent and cannot create a member when cancelled before confirmation', async () => {
    const states: MemberInteractionState[] = [];
    const writes: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') writes.push(String(input));
        return Response.json(targetProjection(date));
      }),
    );
    const container = await render(
      <PersonnelWorkspace
        focusedNewHire
        summary={{ asOf: date }}
        members={[]}
        onInteractionState={(state) => states.push(state)}
      />,
    );
    await fill(field(container, 'Employee ID'), 'SYNTHETIC_CANCELLED_001');
    await fill(field(container, 'First name'), 'Synthetic');
    await fill(field(container, 'Last name'), 'Cancelled');
    await fill(field(container, 'RSC seniority'), '519');
    await fill(field(container, 'Operator reason'), 'Synthetic draft for cancellation');
    await submit(form(container, 'personnel-change-form'));
    expect(states.at(-1)).toEqual({ dirty: true, busy: false, uncertain: false });
    const root = roots.pop();
    if (!root) throw new Error('Missing mounted focused form');
    await act(async () => root.unmount());
    expect(writes).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('uses the shared dated target projection and renders actual preview before retaining a lost personnel commit', async () => {
    const changes: MemberInteractionState[] = [];
    const accepted = vi.fn();
    const requests: { path: string; init?: RequestInit }[] = [];
    let commits = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === '/api/auth/csrf') return csrf();
        requests.push({ path, ...(init ? { init } : {}) });
        if (path.startsWith('/api/admin/department/current-roster'))
          return Response.json(targetProjection(date));
        if (path.endsWith('/preview')) return Response.json(personnelPreview);
        if (path === '/api/admin/personnel/changes') {
          commits += 1;
          if (commits === 1) throw new TypeError('Synthetic commit response lost');
          if (commits === 2)
            return Response.json({ error: 'authentication_required' }, { status: 401 });
          if (commits === 3)
            return Response.json({ error: 'idempotency_key_reused' }, { status: 409 });
          return receipt(init);
        }
        throw new Error(`Unplanned route ${path}`);
      }),
    );
    const container = await render(
      <PersonnelWorkspace
        focusedMember
        summary={{ asOf: date }}
        members={[member]}
        memberIdHint={member.id}
        onInteractionState={(state) => changes.push(state)}
        onAccepted={accepted}
      />,
    );
    expect(container.textContent).not.toContain('Personnel health');
    expect(container.textContent).not.toContain('Member projection and history');
    expect(container.querySelector('[data-testid="temporary-overlay-form"]')).toBeNull();
    const options = [...(field(container, 'Change type') as HTMLSelectElement).options].map(
      (option) => option.value,
    );
    expect(options).not.toContain('NEW_HIRE');
    expect(options).not.toContain('POSITION_CREATE');
    expect(options).not.toContain('POSITION_RETIRE');
    expect(requests).toHaveLength(1);
    const target = field(container, 'Staffing position') as HTMLSelectElement;
    expect(target.options[1]?.text).toContain(
      'Shift E · Synthetic Station · Synthetic Rescue one · Training Lieutenant · vacant',
    );
    await fill(target, 'synthetic-position-one');
    await fill(field(container, 'Operator reason'), 'Synthetic reviewed transfer');
    const targetForm = form(container, 'personnel-change-form');
    await submit(targetForm);
    expect(commits).toBe(0);
    expect(
      container.querySelector('[aria-label="Personnel change preview"]')?.textContent,
    ).toContain('Vacant on the effective date');
    expect(container.textContent).toContain(
      'Unknown — this preview does not evaluate qualifications.',
    );
    await fill(field(container, 'Operator reason'), 'Synthetic revised transfer');
    expect(container.querySelector('[aria-label="Personnel change preview"]')).toBeNull();
    await submit(targetForm);
    await submit(targetForm);
    expect(commits).toBe(1);
    expect(changes.at(-1)).toEqual({ dirty: true, busy: false, uncertain: true });
    expect(targetForm.querySelector('fieldset')?.disabled).toBe(true);
    expect(accepted).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    await submit(targetForm);
    expect(changes.at(-1)?.uncertain).toBe(true);
    expect(accepted).not.toHaveBeenCalled();
    await submit(targetForm);
    expect(changes.at(-1)?.uncertain).toBe(true);
    expect(accepted).not.toHaveBeenCalled();
    await submit(targetForm);
    const writes = requests.filter((request) => request.path === '/api/admin/personnel/changes');
    expect(writes).toHaveLength(4);
    for (const write of writes.slice(1)) {
      expect(write.init?.body).toBe(writes[0]?.init?.body);
      expect(new Headers(write.init?.headers).get('Idempotency-Key')).toBe(
        new Headers(writes[0]?.init?.headers).get('Idempotency-Key'),
      );
    }
    expect(writes[0]?.init?.body).toBe(writes[1]?.init?.body);
    expect(JSON.parse(String(writes[1]?.init?.body)).staffing_position_id).toBe(
      'synthetic-position-one',
    );
    expect(new Headers(writes[0]?.init?.headers).get('Idempotency-Key')).toBe(
      new Headers(writes[1]?.init?.headers).get('Idempotency-Key'),
    );
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(changes.some((state) => state.busy)).toBe(true);
    expect(changes.at(-1)).toEqual({ dirty: false, busy: false, uncertain: false });
  });

  it('cancels dated target loads and cannot restore an old target after the effective date changes', async () => {
    let oldSignal: AbortSignal | null = null;
    let resolveOld!: (value: Response) => void;
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        if (calls === 1) {
          oldSignal = init?.signal ?? null;
          return new Promise<Response>((resolve) => {
            resolveOld = resolve;
          });
        }
        const asOf = new URL(String(input), 'http://localhost').searchParams.get('as_of') ?? '';
        return Promise.resolve(Response.json(targetProjection(asOf, 'new-date')));
      }),
    );
    const container = await render(
      <PersonnelWorkspace
        focusedMember
        summary={{ asOf: date }}
        members={[member]}
        memberIdHint={member.id}
      />,
    );
    await fill(field(container, 'Effective date'), '2026-10-01');
    expect((oldSignal as AbortSignal | null)?.aborted).toBe(true);
    await act(async () => resolveOld(Response.json(targetProjection(date, 'stale'))));
    const options = [...(field(container, 'Staffing position') as HTMLSelectElement).options].map(
      (option) => option.value,
    );
    expect(options).toEqual(['', 'synthetic-position-new-date']);
  });

  for (const mismatch of ['member', 'effective date'] as const) {
    it(`refuses a complete personnel preview for another ${mismatch}`, async () => {
      const requests: string[] = [];
      const wrong = structuredClone(personnelPreview);
      if (mismatch === 'member') wrong.current.member.id = 981099;
      else wrong.proposed.event.effectiveOn = '2026-10-01';
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const path = String(input);
          if (path === '/api/auth/csrf') return csrf();
          if (path.includes('current-roster')) return Response.json(targetProjection(date));
          requests.push(path);
          if (path.endsWith('/preview')) return Response.json(wrong);
          throw new Error('A mismatched preview must not authorize a commit');
        }),
      );
      const container = await render(
        <PersonnelWorkspace
          focusedMember
          summary={{ asOf: date }}
          members={[member]}
          memberIdHint={member.id}
        />,
      );
      await fill(field(container, 'Staffing position'), 'synthetic-position-one');
      await fill(field(container, 'Operator reason'), 'Synthetic reviewed transfer');
      await submit(form(container, 'personnel-change-form'));
      await submit(form(container, 'personnel-change-form'));
      expect(requests).toEqual([
        '/api/admin/personnel/changes/preview',
        '/api/admin/personnel/changes/preview',
      ]);
      expect(container.querySelector('[aria-label="Personnel change preview"]')).toBeNull();
      expect(container.textContent).toContain('A complete personnel preview was not returned');
      expect(refresh).not.toHaveBeenCalled();
    });
  }

  it('treats a mismatched successful personnel response as uncertain and preserves the pending request', async () => {
    const accepted = vi.fn();
    const states: MemberInteractionState[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === '/api/auth/csrf') return csrf();
        if (path.includes('current-roster')) return Response.json(targetProjection(date));
        if (path.endsWith('/preview')) return Response.json(personnelPreview);
        return Response.json({
          replayed: false,
          event: { id: 'other-person', memberId: 3, kind: 'TRANSFER', effectiveOn: date },
        });
      }),
    );
    const container = await render(
      <PersonnelWorkspace
        focusedMember
        summary={{ asOf: date }}
        members={[member]}
        memberIdHint={member.id}
        onInteractionState={(state) => states.push(state)}
        onAccepted={accepted}
      />,
    );
    await fill(field(container, 'Staffing position'), 'synthetic-position-one');
    await fill(field(container, 'Operator reason'), 'Synthetic reviewed transfer');
    await submit(form(container, 'personnel-change-form'));
    await submit(form(container, 'personnel-change-form'));
    expect(states.at(-1)?.uncertain).toBe(true);
    expect(accepted).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  for (const failure of ['lost response', 'mismatched receipt'] as const) {
    it(`keeps credential preview unknown states and retries the identical request after ${failure}`, async () => {
      const accepted = vi.fn();
      const states: MemberInteractionState[] = [];
      const writes: RequestInit[] = [];
      const paths: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = String(input);
          paths.push(path);
          if (path === '/api/auth/csrf') return csrf();
          if (path.endsWith('/preview')) return Response.json(credentialPreview);
          if (path === '/api/admin/qualification-lifecycle/events' && init) {
            writes.push(init);
            if (writes.length === 1) {
              if (failure === 'lost response') throw new TypeError('Synthetic response lost');
              return Response.json({
                replayed: false,
                event: {
                  id: 'wrong-member',
                  memberId: 4,
                  kind: 'CERTIFICATION_GAINED',
                  effectiveOn: date,
                },
              });
            }
            if (writes.length === 2)
              return Response.json(
                {
                  error:
                    failure === 'lost response'
                      ? 'authentication_required'
                      : 'idempotency_key_reused',
                },
                { status: failure === 'lost response' ? 401 : 409 },
              );
            return receipt(init);
          }
          throw new Error(`Unplanned route ${path}`);
        }),
      );
      const container = await render(
        <QualificationLifecycleWorkspace
          focusedMember
          asOf={date}
          members={[member]}
          memberIdHint={member.id}
          credentials={[{ id: 991, name: 'Synthetic Rescue Credential', fyPointsDefault: 0 }]}
          onInteractionState={(state) => states.push(state)}
          onAccepted={accepted}
        />,
      );
      expect(paths).toEqual([]);
      expect(container.querySelector('[data-testid="qualification-member"]')).toBeNull();
      expect(
        container.querySelector('[aria-labelledby="qualification-history-heading"]'),
      ).toBeNull();
      expect(container.textContent).toContain('Credential change');
      await fill(field(container, 'Evidence source'), 'Synthetic training registry');
      await fill(field(container, 'Reason'), 'Synthetic evidence reviewed');
      const targetForm = form(container, 'qualification-event-form');
      await submit(targetForm);
      expect(writes).toHaveLength(0);
      await submit(targetForm, true);
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(container.textContent).toContain('Ineligible → Eligible');
      expect(container.textContent).toContain('qualification evaluation date required');
      await fill(field(container, 'Reason'), 'Synthetic corrected evidence review');
      expect(container.querySelector('[aria-label="Qualification impact preview"]')).toBeNull();
      await submit(targetForm, true);
      await submit(targetForm);
      expect(states.at(-1)).toEqual({ dirty: true, busy: false, uncertain: true });
      expect(targetForm.querySelector('fieldset')?.disabled).toBe(true);
      expect(accepted).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      await submit(targetForm);
      expect(states.at(-1)?.uncertain).toBe(true);
      expect(accepted).not.toHaveBeenCalled();
      await submit(targetForm);
      expect(writes).toHaveLength(3);
      expect(writes[0]?.body).toBe(writes[1]?.body);
      expect(writes[0]?.body).toBe(writes[2]?.body);
      expect(new Headers(writes[0]?.headers).get('Idempotency-Key')).toBe(
        new Headers(writes[1]?.headers).get('Idempotency-Key'),
      );
      expect(new Headers(writes[0]?.headers).get('Idempotency-Key')).toBe(
        new Headers(writes[2]?.headers).get('Idempotency-Key'),
      );
      expect(accepted).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledWith('qualification');
      expect(states.at(-1)).toEqual({ dirty: false, busy: false, uncertain: false });
    });
  }
});
