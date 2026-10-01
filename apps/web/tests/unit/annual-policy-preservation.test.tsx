// @vitest-environment jsdom
import { BidDispositionSchema, FrozenLiveBidPolicySchema, LiveBidActionSchema } from '@mbfd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnnualPolicyWorkspace } from '../../app/admin/annual-policy/AnnualPolicyWorkspace';

const drafts = vi.hoisted(() => ({
  current: null as null | {
    value: Record<string, unknown>;
    onRestore: (value: Record<string, unknown>) => void;
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/admin/WorkingDraftPanel', () => ({
  WorkingDraftPanel: (props: NonNullable<typeof drafts.current>) => {
    drafts.current = props;
    return null;
  },
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

function policy() {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-policy-1',
    stages: [
      {
        id: 'ordinary',
        label: 'Ordinary',
        order: 0,
        kind: 'CAPTAIN',
        memberIds: [901],
        opportunityPositionIds: ['p1'],
      },
    ],
    dispositions: BidDispositionSchema.options.map((disposition) => ({
      disposition,
      advances: true,
      returns: false,
      returnStageId: null,
      retainsLaterSelectionRights: false,
      terminal: false,
      requiresReason: true,
      requiresEvidence: false,
      contactPolicyReference: null,
    })),
    actionPermissions: LiveBidActionSchema.options.map((action) => ({
      action,
      actorMemberIds: [901],
    })),
    specialtyCatalogReference: 'Synthetic specialty source',
    aDayPolicyReference: 'Synthetic A-Day source',
    transitionPolicyReference: 'Synthetic transition source',
    publicationPolicyReference: 'Synthetic publication source',
    annualOperations: {
      v: 1,
      stageOrder: ['ordinary'],
      requiredTopologyPositionIds: ['p1'],
      specialties: [
        {
          id: 'synthetic-specialty',
          label: 'Synthetic specialty',
          mode: 'PRIORITY_ONLY',
          opportunityPositionIds: ['p1'],
          requiredCredentialNames: [],
          requiredSpecialtyCodes: [],
          points: [],
          tieBreakChain: ['RSC_SENIORITY'],
        },
      ],
      contact: { minimumAttempts: 1, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      membershipDistributions: [
        {
          id: 'reviewed-membership',
          label: 'Reviewed membership',
          sourceRef: 'Synthetic reviewed membership',
          sourceDecisionId: 'synthetic-membership',
          membershipSource: 'REVIEWED_EXISTING_MEMBERS',
          memberIds: [901],
          shifts: ['A'],
          minimumPerShift: 0,
          maximumPerShift: 1,
          maximumPerADay: 1,
        },
      ],
      aDay: {
        combatGroups: ['G1'],
        min: 0,
        max: 10,
        captainDcMax: 2,
        specialtyMaximums: { MARINE_ASSIGNED: 9, MARINE_FLOAT: null, DE: 9, SWAT: 9 },
        execution: {
          timing: 'SIMULTANEOUS',
          officersPerGroup: null,
          sourceRef: 'Synthetic scoped source',
          constraints: [
            {
              id: 'scoped',
              label: 'Scoped capacity',
              sourceRef: 'Synthetic scoped capacity',
              maximum: 1,
              positionIds: ['p1'],
              memberIds: [],
              ranks: [],
              shifts: ['A'],
            },
          ],
        },
      },
    },
  });
}

const source = {
  rule_book_version: '2088.1',
  configuration_revision: 1,
  rule_book_revision: 1,
  source_revision: 1,
  managed_annual_plan: false,
  credential_evaluation_on: '2088-01-01',
  members: [
    {
      member_id: 901,
      first_name: 'Synthetic',
      last_name: 'Operator',
      rank: 'CPT',
      pool: 'OFC',
      rsc_seniority: 1,
      rank_seniority: 1,
      credential_names: [],
      specialty_qualification_codes: [],
    },
  ],
  positions: [
    {
      id: 'p1',
      shift: 'A',
      station: 'Synthetic',
      unit: 'Synthetic',
      rank_required: 'CPT',
      position_name: 'Synthetic seat',
    },
  ],
};
const clients: QueryClient[] = [];
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const client of clients.splice(0)) client.clear();
  document.body.replaceChildren();
  drafts.current = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount() {
  const original = policy();
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/auth/csrf')
        return Response.json({ token: 'csrf_00000000-0000-4000-8000-000000000001' });
      if (init?.method === 'POST') {
        writes.push(JSON.parse(String(init.body)));
        return Response.json({ ok: true });
      }
      return Response.json(source);
    }),
  );
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  client.setQueryData(['admin', 'annual-policy', 2088, 'editor-data'], source);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <AnnualPolicyWorkspace
          year={2088}
          loadError={null}
          documents={[
            {
              id: 'synthetic-doc',
              rule_book_version: '2088.1',
              effective_year: 2088,
              revision: 1,
              status: 'DRAFT',
              policy_text: 'Synthetic approved policy language for preservation testing.',
              execution_policy: original,
              supersedes_document_id: null,
              published_at: null,
            },
          ]}
        />
      </QueryClientProvider>,
    ),
  );
  const load = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === 'Load as new draft',
  );
  if (!load) throw new Error('Missing load action');
  await act(async () => load.click());
  return { container, original, writes };
}
function draft() {
  if (!drafts.current) throw new Error('Missing draft state');
  return drafts.current;
}
async function input(container: HTMLElement, label: string, value: string) {
  const element = Array.from(container.querySelectorAll('input,textarea')).find(
    (field) =>
      field.getAttribute('aria-label') === label ||
      Array.from((field as HTMLInputElement).labels ?? []).some(
        (item) => item.textContent?.trim() === label,
      ),
  ) as HTMLInputElement | HTMLTextAreaElement | undefined;
  if (!element) throw new Error(`Missing ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('annual policy capacity preservation', () => {
  it('preserves scoped execution and reviewed memberships through private draft restore and revision save', async () => {
    const { container, original, writes } = await mount();
    const saved = structuredClone(draft().value);
    await act(async () => draft().onRestore(saved));
    await input(container, 'Executable policy revision', 'synthetic-policy-2');
    await input(container, 'Revision reason', 'Synthetic source-backed revision');
    expect(draft().value.policyRevision).toBe('synthetic-policy-2');
    expect(draft().value.reason).toBe('Synthetic source-backed revision');
    expect(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Save new draft revision',
      )?.disabled,
    ).toBe(false);
    const form = container.querySelector('form');
    if (!form) throw new Error('Missing form');
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(container.querySelector('output')?.textContent).toBe(
      'Draft saved and bound for mock verification.',
    );
    expect(writes).toHaveLength(1);
    const savedPolicy = FrozenLiveBidPolicySchema.parse(writes[0]?.execution_policy);
    expect(savedPolicy.annualOperations?.aDay).toEqual(original.annualOperations?.aDay);
    expect(savedPolicy.annualOperations?.membershipDistributions).toEqual(
      original.annualOperations?.membershipDistributions,
    );
  });
  it('rejects a legacy private draft before changing loaded scoped material', async () => {
    await mount();
    const before = structuredClone(draft().value);
    const { savedAnnual: _savedAnnual, ...legacy } = before;
    expect(() => draft().onRestore(legacy)).toThrow('Invalid saved draft');
    expect(draft().value).toEqual(before);
  });
});
