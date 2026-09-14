// @vitest-environment jsdom
import {
  type BidDefinitionContent,
  BidDefinitionContentSchema,
  type BidDefinitionRule,
  BidDispositionSchema,
  type ConfiguredScoring,
  type FrozenLiveBidPolicy,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, act, useState } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateEligibility } from '../../../../packages/eligibility/src/evaluate';
import type { Member, PositionRule } from '../../../../packages/eligibility/src/types';
import {
  NullableText,
  NumberField,
  OrderedChoices,
  ReferencePicker,
} from '../../app/admin/current-bid/BidFields';
import { BidOpportunityFields } from '../../app/admin/current-bid/BidOpportunityFields';
import { BidPolicyFields, type PolicySection } from '../../app/admin/current-bid/BidPolicyFields';
import { BidRuleFields } from '../../app/admin/current-bid/BidRuleFields';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const roots: Root[] = [];
const clients: QueryClient[] = [];
const MISSING = 'Synthetic missing qualification';
const AS_OF = '2027-02-01';
const catalog = [
  { id: 1, policyName: 'All A', name: 'Renamed display for All A' },
  { id: 2, policyName: 'Either B', name: 'Display B' },
  { id: 3, policyName: 'Either C', name: 'Display C' },
  { id: 4, policyName: 'Either D', name: 'Display D' },
];

function advancedScoring(): ConfiguredScoring {
  return {
    v: 1,
    total: [
      {
        id: 'synthetic-ordered-total',
        cap: 5,
        items: [
          {
            credential: 'All A',
            alternatives: ['Either B'],
            requiresAll: ['Either C'],
            points: 3,
            completionCredit: {
              sourceRef: 'Synthetic completion authority',
              effectiveFrom: '2027-01-01',
              effectiveThrough: '2027-12-31',
              memberIds: [901, 999],
            },
          },
          { credential: 'Either D', alternatives: [], requiresAll: [], points: 4 },
        ],
      },
    ],
    so: [
      {
        id: 'synthetic-so',
        cap: null,
        items: [{ credential: MISSING, alternatives: [], requiresAll: [], points: 9 }],
      },
    ],
    mo: [],
  };
}

function baseRule(): BidDefinitionRule {
  return {
    positionId: 'synthetic-seat-1',
    requiredCriteriaJson: JSON.stringify({
      rank: ['FF'],
      credentials: ['All A', MISSING],
      custom: ['non_probationary'],
      anyOfCredentials: [['Either B', MISSING], ['Either D']],
      service: [{ serviceCode: 'SYNTHETIC_SERVICE', minimumMonths: 12 }],
      postAward: [
        {
          id: 'synthetic-term',
          credential: MISSING,
          sourceRef: 'Synthetic follow-up authority',
          deadline: {
            basis: 'APPROVED_BID_START_DATE',
            startOn: '2027-03-01',
            unit: 'CALENDAR_MONTHS',
            count: 3,
            timeZone: 'America/New_York',
          },
        },
      ],
    }),
    pointsPreferenceJson: JSON.stringify({
      max: 5,
      items: [{ credential: MISSING, points: 3, requiresOpsPair: false }],
    }),
    tieBreakChainJson: '["points", "rsc_seniority", "rank_seniority"]',
    notes: null,
  };
}

function basePolicy(): FrozenLiveBidPolicy {
  return {
    v: 1,
    policyRevision: 'Synthetic policy authority',
    stages: [
      {
        id: 'stage-one',
        label: 'Synthetic first stage',
        order: 0,
        kind: 'MIXED',
        memberIds: [901, 999],
        opportunityPositionIds: ['synthetic-seat-1'],
      },
      {
        id: 'stage-two',
        label: 'Synthetic second stage',
        order: 1,
        kind: 'MIXED',
        memberIds: [902],
        opportunityPositionIds: ['synthetic-seat-2'],
      },
    ],
    dispositions: BidDispositionSchema.options.map((disposition) => ({
      disposition,
      advances: true,
      returns: disposition === 'DEFER',
      returnStageId: disposition === 'DEFER' ? 'stage-two' : null,
      retainsLaterSelectionRights: true,
      terminal: false,
      requiresReason: true,
      requiresEvidence: false,
      contactPolicyReference: 'Synthetic contact authority',
    })),
    actionPermissions: LiveBidActionSchema.options.map((action) => ({
      action,
      actorMemberIds: [901, 999],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: 'Synthetic A-Day authority',
    transitionPolicyReference: null,
    publicationPolicyReference: 'Synthetic publication authority',
    annualOperations: {
      v: 1,
      stageOrder: ['stage-one', 'stage-two'],
      requiredTopologyPositionIds: ['synthetic-seat-1'],
      contact: { minimumAttempts: 2, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 1,
        max: 30,
        captainDcMax: 2,
        specialtyMaximums: { MARINE_ASSIGNED: 2, MARINE_FLOAT: 1, DE: 2, SWAT: 3 },
      },
      specialties: [
        {
          id: 'synthetic-specialty',
          label: 'Synthetic specialty',
          mode: 'PRIORITY_ONLY',
          opportunityPositionIds: ['synthetic-seat-1'],
          requiredCredentialNames: [MISSING],
          requiredSpecialtyCodes: ['SYNTHETIC_ONE', 'SYNTHETIC_TWO'],
          points: [{ credentialName: MISSING, value: 4 }],
          tieBreakChain: ['POINTS', 'RSC_SENIORITY'],
        },
      ],
    },
  };
}

function baseContent(): BidDefinitionContent {
  const policy = basePolicy();
  return BidDefinitionContentSchema.parse({
    v: 1,
    bidYear: 2027,
    settings: {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-15',
      livePolicy: policy,
    },
    notes: { bid: 'Synthetic preserved notes', positions: null },
    policy: {
      policyText: 'Synthetic source language\nwith deliberate spacing.',
      executionPolicy: structuredClone(policy),
    },
    planning: {
      effectiveOn: AS_OF,
      sourceSessionId: 'synthetic-source-session',
      sourcePolicyText: null,
    },
    authoring: {
      profiles: [
        {
          id: 'synthetic-profile',
          name: 'Synthetic historical profile',
          sourceRef: 'Synthetic profile authority',
          scope: { kind: 'department' },
          requirements: { credentials: [], custom: [] },
        },
      ],
      compiled: [
        {
          rule: baseRule(),
          provenance: {
            requirements: ['synthetic-profile'],
            scoring: [],
            priorities: [],
            matched: ['synthetic-profile'],
          },
        },
      ],
      reconciliation: 'RULES_CHANGED_AFTER_COMPILATION',
    },
    positions: [1, 2].map((id) => ({
      id: `synthetic-seat-${id}`,
      positionName: `Synthetic opportunity ${id}`,
      shift: 'A',
      station: 'Synthetic station',
      unit: 'Synthetic unit',
      division: 'Synthetic division',
      rankRequired: 'FF',
      isFloating: false,
      isVacantByDesign: false,
      isExcludedFromCount: false,
    })),
    rules: [
      baseRule(),
      { ...baseRule(), positionId: 'synthetic-seat-2', notes: 'Synthetic sibling rule' },
    ],
    participation: [
      {
        positionId: 'synthetic-seat-1',
        bidParticipation: 'BIDDABLE',
        authoritativeSourceRef: 'Synthetic participation authority',
      },
    ],
    staffingBindings: [
      {
        positionId: 'synthetic-seat-1',
        staffingPositionId: 'saved-missing-slot',
        authoritativeSourceRef: 'Synthetic original pair authority',
        reviewStatus: 'approved',
      },
    ],
    sourceDecisions: [
      {
        issueId: 'synthetic-source-decision',
        title: 'Synthetic source decision',
        question: 'Which approved source?',
        area: 'rules',
        status: 'OPEN',
        decision: '',
        sourceRef: '',
        effectiveOn: AS_OF,
      },
    ],
  });
}

function live(content: BidDefinitionContent) {
  if (content.settings?.v !== 3) throw new Error('Expected V3 policy');
  return content.settings.livePolicy;
}
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('Synthetic test fixture is incomplete');
  return value;
}
function ops(content: BidDefinitionContent) {
  const value = live(content).annualOperations;
  if (!value) throw new Error('Expected annual operations');
  return value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unexpected field-editor network call');
    }),
  );
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const client of clients.splice(0)) client.clear();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderState<T>(initial: T, render: (value: T, onChange: (next: T) => void) => ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  clients.push(client);
  client.setQueryData(['admin', 'credentials'], catalog);
  client.setQueryData(['admin', 'service-evidence', 'types'], {
    types: [{ id: 'SYNTHETIC_SERVICE', name: 'Synthetic dated service' }],
  });
  client.setQueryData(
    ['admin', 'current-bid', 'member-options'],
    [
      { value: '901', label: 'Synthetic member 901' },
      { value: '902', label: 'Synthetic member 902' },
    ],
  );
  client.setQueryData(
    ['admin', 'scoring-members'],
    [{ id: 901, employeeId: 'SYNTHETIC901', firstName: 'Synthetic', lastName: 'Member' }],
  );
  client.setQueryData(
    ['admin', 'current-bid', 'staffing-options', AS_OF],
    [{ value: 'new-slot', label: 'Synthetic new staffing slot' }],
  );
  let current = freeze(structuredClone(initial));
  const changes: T[] = [];
  function Controlled() {
    const [value, setValue] = useState(current);
    return render(value, (next) => {
      current = next;
      changes.push(structuredClone(next));
      setValue(next);
    });
  }
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Controlled />
      </QueryClientProvider>,
    ),
  );
  return { container, client, changes, value: () => current };
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
function control(scope: HTMLElement, text: string): Control {
  const fields: Control[] = [
    ...scope.querySelectorAll('input'),
    ...scope.querySelectorAll('textarea'),
    ...scope.querySelectorAll('select'),
  ];
  const matches = fields.filter((field) =>
    Array.from(field.labels ?? []).some((label) => label.textContent?.trim() === text),
  );
  if (matches.length !== 1)
    throw new Error(`Expected one control '${text}', found ${matches.length}`);
  return required(matches[0]);
}
function group(scope: HTMLElement, text: string): HTMLFieldSetElement {
  const found = Array.from(scope.querySelectorAll('fieldset')).find(
    (field) => field.querySelector(':scope > legend')?.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing fieldset '${text}'`);
  return found;
}
function button(scope: HTMLElement, text: string): HTMLButtonElement {
  const matches = Array.from(scope.querySelectorAll('button')).filter(
    (element) => element.textContent?.trim() === text,
  );
  if (matches.length !== 1)
    throw new Error(`Expected one button '${text}', found ${matches.length}`);
  return required(matches[0]);
}
async function click(element: Pick<HTMLElement, 'click'>) {
  await act(async () => element.click());
}
async function setValue(field: Control, value: string) {
  await act(async () => {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : field instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function policyEditor(content = baseContent(), section: PolicySection = 'language') {
  return renderState(content, (value, onChange) => (
    <BidPolicyFields content={value} section={section} onChange={onChange} />
  ));
}
function ruleEditor(rule = baseRule()) {
  return renderState(rule, (value, onChange) => <BidRuleFields rule={value} onChange={onChange} />);
}
async function opportunityEditor(content = baseContent()) {
  const state = renderState(content, (value, onChange) => (
    <BidOpportunityFields content={value} onChange={onChange} />
  ));
  await click(required(state.container.querySelector<HTMLButtonElement>('button[aria-pressed]')));
  return state;
}
function evaluation(rule: BidDefinitionRule, credentials: string[]) {
  const material: PositionRule = {
    positionId: rule.positionId,
    ruleBookVersion: 'synthetic-version',
    requiredCriteria: JSON.parse(rule.requiredCriteriaJson),
    pointsPreference: JSON.parse(rule.pointsPreferenceJson),
    tieBreakChain: JSON.parse(rule.tieBreakChainJson),
  };
  const member: Member = {
    employeeId: 'SYNTHETIC901',
    firstName: 'Synthetic',
    lastName: 'Member',
    rank: 'FF',
    rscSeniority: 1,
    rankSeniority: 1,
    isProbationary: false,
    credentials: credentials.map((name) => ({ name })),
  };
  return evaluateEligibility(member, material);
}

describe('Bid field primitives preserve intent', () => {
  it('searching/paging never drops missing or off-page references and toggles only the selected identity', async () => {
    const options = Array.from({ length: 45 }, (_, index) => ({
      value: String(index + 1),
      label: `Synthetic option ${index + 1}`,
    }));
    const state = renderState(['45', 'missing-id'], (value, onChange) => (
      <ReferencePicker
        label="Synthetic references"
        values={value}
        options={options}
        onChange={onChange}
      />
    ));
    await click(button(state.container, 'Next choices'));
    await setValue(control(state.container, 'Find synthetic references'), 'missing-id');
    expect(
      control(state.container, 'missing-id · Saved selection; catalog review required'),
    ).toHaveProperty('checked', true);
    expect(state.changes).toEqual([]);
    await setValue(control(state.container, 'Find synthetic references'), 'Synthetic option 1');
    await click(control(state.container, 'Synthetic option 1'));
    expect(state.value()).toEqual(['45', 'missing-id', '1']);
    await setValue(control(state.container, 'Find synthetic references'), 'missing-id');
    await click(control(state.container, 'missing-id · Saved selection; catalog review required'));
    expect(state.value()).toEqual(['45', '1']);
  });

  it('does not turn a blank number into zero and requires an explicit nullable text transition', async () => {
    const state = renderState({ cap: 8, text: null as string | null }, (value, onChange) => (
      <>
        <NumberField
          label="Cap"
          value={value.cap}
          onChange={(cap) => onChange({ ...value, cap })}
        />
        <NullableText
          label="Authority"
          value={value.text}
          onChange={(text) => onChange({ ...value, text })}
        />
      </>
    ));
    await setValue(control(state.container, 'Cap'), '');
    expect(state.changes).toEqual([]);
    expect(state.value()).toEqual({ cap: 8, text: null });
    await click(control(state.container, 'Include authority'));
    expect(state.value()).toEqual({ cap: 8, text: '' });
    await setValue(control(state.container, 'Authority'), 'Synthetic explicit authority');
    await setValue(control(state.container, 'Cap'), '0');
    expect(state.value()).toEqual({ cap: 0, text: 'Synthetic explicit authority' });
    await click(control(state.container, 'Include authority'));
    expect(state.value()).toEqual({ cap: 0, text: null });
  });

  it('keeps tie precedence explicit when moving or removing one priority', async () => {
    const state = renderState(['points', 'rsc', 'rank'], (value, onChange) => (
      <OrderedChoices
        label="Priority"
        values={value}
        options={['points', 'rsc', 'rank'].map((key) => ({ value: key, label: key }))}
        onChange={onChange}
      />
    ));
    const rankRow = control(state.container, 'Priority 3').closest('div.min-w-40')?.parentElement;
    if (!rankRow) throw new Error('Missing ordered priority row');
    await click(button(rankRow, 'Move up'));
    expect(state.value()).toEqual(['points', 'rank', 'rsc']);
    const row = control(state.container, 'Priority 2').closest('div.min-w-40')?.parentElement;
    if (!row) throw new Error('Missing ordered priority row');
    await click(button(row, 'Remove'));
    expect(state.value()).toEqual(['points', 'rsc']);
  });
});

describe('BidRuleFields', () => {
  it('keeps raw rule columns and optional absence intact when only notes change', async () => {
    const original = {
      ...baseRule(),
      requiredCriteriaJson: '{ "rank": ["FF"], "credentials": [], "custom": [] }',
    };
    const state = ruleEditor(original);
    expect(state.changes).toEqual([]);
    await click(control(state.container, 'Include rule notes'));
    await setValue(control(state.container, 'Rule notes'), 'Synthetic note only');
    expect(state.value()).toEqual({ ...original, notes: 'Synthetic note only' });
    expect(JSON.parse(state.value().requiredCriteriaJson)).not.toHaveProperty('service');
    expect(JSON.parse(state.value().requiredCriteriaJson)).not.toHaveProperty('postAward');
    expect(JSON.parse(state.value().requiredCriteriaJson)).not.toHaveProperty('anyOfCredentials');
  });

  it('edits one OR group without flattening AND requirements, sibling groups or missing saved references', async () => {
    const original = {
      ...baseRule(),
      requiredCriteriaJson: JSON.stringify({
        rank: ['FF'],
        credentials: ['All A'],
        custom: [],
        anyOfCredentials: [['Either B', MISSING], ['Either D']],
      }),
    };
    const state = ruleEditor(original);
    const alternatives = group(state.container, 'Qualification alternatives 1');
    await click(control(alternatives, 'Display C'));
    expect(JSON.parse(state.value().requiredCriteriaJson)).toEqual({
      rank: ['FF'],
      credentials: ['All A'],
      custom: [],
      anyOfCredentials: [['Either B', MISSING, 'Either C'], ['Either D']],
    });
    expect(state.value().pointsPreferenceJson).toBe(original.pointsPreferenceJson);
    expect(evaluation(state.value(), ['All A', 'Either C', 'Either D']).eligible).toBe(true);
    expect(evaluation(state.value(), ['All A', 'Either B', 'Either D']).eligible).toBe(true);
    expect(evaluation(state.value(), ['Either C', 'Either D']).eligible).toBe(false);
    expect(evaluation(state.value(), ['All A', 'Either C']).eligible).toBe(false);
    await click(button(state.container, 'Remove alternatives group 1'));
    expect(JSON.parse(state.value().requiredCriteriaJson).anyOfCredentials).toEqual([['Either D']]);
  });

  it('edits grouped caps without losing ordered awards, OR aliases, AND prerequisites or completion provenance', async () => {
    const scoring = advancedScoring();
    const original = {
      ...baseRule(),
      requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
      pointsPreferenceJson: JSON.stringify({ max: 0, items: [], scoring }),
    };
    const state = ruleEditor(original);
    const total = group(state.container, 'Total points');
    await setValue(control(total, 'Group cap (blank means uncapped)'), '4');
    const expected = structuredClone(scoring);
    required(expected.total[0]).cap = 4;
    expect(JSON.parse(state.value().pointsPreferenceJson)).toEqual({
      max: 0,
      items: [],
      scoring: expected,
    });
    expect(
      evaluation(state.value(), ['Either B', 'Either C', 'Either D']).breakdown.itemized.map(
        (item) => item.awarded,
      ),
    ).toEqual([3, 1]);
    expect(
      evaluation(state.value(), ['Either B', 'Either D']).breakdown.itemized.map(
        (item) => item.awarded,
      ),
    ).toEqual([0, 4]);
    expect(state.value().requiredCriteriaJson).toBe(original.requiredCriteriaJson);
    expect(state.value().tieBreakChainJson).toBe(original.tieBreakChainJson);
  });

  it('removes only explicitly selected grouped scoring and does not invent default point awards', async () => {
    const original = {
      ...baseRule(),
      pointsPreferenceJson: JSON.stringify({ max: 0, items: [], scoring: advancedScoring() }),
    };
    const state = ruleEditor(original);
    expect(state.changes).toEqual([]);
    await click(button(state.container, 'Remove grouped scoring'));
    expect(state.value()).toEqual({ ...original, pointsPreferenceJson: '{"max":0,"items":[]}' });
    expect(state.container.textContent).toContain('Zero does not disable scoring');
  });

  it('retains missing point identities and records only explicitly selected Operations gate semantics', async () => {
    const original = baseRule();
    const state = ruleEditor(original);
    const award = group(state.container, 'Point award 1');
    expect(control(award, 'Qualification')).toHaveProperty('value', MISSING);
    await setValue(control(award, 'Operations requirement'), 'all_operations');
    expect(JSON.parse(state.value().pointsPreferenceJson).items).toEqual([
      { credential: MISSING, points: 3, requiresOpsPair: false, opsGate: 'all_operations' },
    ]);
    await setValue(control(award, 'Operations requirement'), 'paired_operation');
    expect(JSON.parse(state.value().pointsPreferenceJson).items[0]).toMatchObject({
      requiresOpsPair: true,
      opsGate: 'paired_operation',
    });
    await setValue(control(award, 'Operations requirement'), 'none');
    expect(JSON.parse(state.value().pointsPreferenceJson).items[0]).toEqual({
      credential: MISSING,
      points: 3,
      requiresOpsPair: false,
    });
    expect(state.value().requiredCriteriaJson).toBe(original.requiredCriteriaJson);
  });

  it.each(['unknown-requirement', 'mixed-scoring', 'unknown-priority'])(
    'refuses unsupported %s without replacing any rule material',
    (kind) => {
      const original = baseRule();
      if (kind === 'unknown-requirement')
        original.requiredCriteriaJson = JSON.stringify({
          rank: ['FF'],
          credentials: [],
          custom: [],
          unrecognizedAuthority: true,
        });
      if (kind === 'mixed-scoring')
        original.pointsPreferenceJson = JSON.stringify({
          max: 5,
          items: [],
          scoring: advancedScoring(),
        });
      if (kind === 'unknown-priority') original.tieBreakChainJson = '["unrecognized_priority"]';
      const state = ruleEditor(original);
      expect(state.container.querySelector('[role="alert"]')?.textContent).toContain(
        'original content is retained',
      );
      expect(state.container.querySelectorAll('input,textarea,select,button')).toHaveLength(0);
      expect(state.changes).toEqual([]);
      expect(state.value()).toEqual(original);
    },
  );
});

describe('BidOpportunityFields', () => {
  it('preserves stable identity, rule/profile provenance and sibling data during descriptive edits', async () => {
    const original = baseContent();
    const state = await opportunityEditor(original);
    expect(state.changes).toEqual([]);
    await setValue(control(state.container, 'Opportunity name'), 'Synthetic renamed opportunity');
    const expected = structuredClone(original);
    required(expected.positions[0]).positionName = 'Synthetic renamed opportunity';
    expect(state.value()).toEqual(expected);
  });

  it('changes participation without silently deleting a rule, then removes only the reviewed rule', async () => {
    const original = baseContent();
    const state = await opportunityEditor(original);
    await setValue(control(state.container, 'Bid participation'), 'RESERVED_NON_BIDDABLE');
    expect(state.value().rules).toEqual(original.rules);
    expect(state.container.textContent).toContain('Remove its Bid rule before saving');
    await click(button(state.container, 'Review rule removal'));
    await click(button(state.container, 'Keep Bid rule'));
    expect(state.value().rules).toEqual(original.rules);
    await click(button(state.container, 'Review rule removal'));
    await click(button(state.container, 'Confirm rule removal'));
    expect(state.value().rules).toEqual([original.rules[1]]);
    expect(state.value().positions).toEqual(original.positions);
    expect(state.value().staffingBindings).toEqual(original.staffingBindings);
    expect(state.value().authoring).toEqual(original.authoring);
    expect(button(state.container, 'Configure requirements').disabled).toBe(true);
  });

  it('requires reviewed opportunity removal and retains independent source/policy references for explicit repair', async () => {
    const original = baseContent();
    const state = await opportunityEditor(original);
    await click(button(state.container, 'Review removal'));
    expect(state.changes).toEqual([]);
    await click(button(state.container, 'Keep opportunity'));
    expect(state.changes).toEqual([]);
    await click(button(state.container, 'Review removal'));
    await click(button(state.container, 'Remove from draft'));
    expect(state.value()).toEqual({
      ...original,
      positions: [original.positions[1]],
      rules: [original.rules[1]],
      participation: [],
      staffingBindings: [],
    });
  });

  it('resets prior pair approval on replacement and unlinks only the explicit staffing connection', async () => {
    const original = baseContent();
    const state = await opportunityEditor(original);
    const bindings = group(state.container, 'Staffing position');
    expect(
      control(bindings, 'saved-missing-slot · Saved selection; catalog review required'),
    ).toHaveProperty('checked', true);
    expect(state.changes).toEqual([]);
    await click(control(bindings, 'Synthetic new staffing slot'));
    expect(state.value().staffingBindings).toEqual([
      {
        positionId: 'synthetic-seat-1',
        staffingPositionId: 'new-slot',
        authoritativeSourceRef: '',
        reviewStatus: 'draft',
      },
    ]);
    expect(state.value().positions).toEqual(original.positions);
    expect(state.value().rules).toEqual(original.rules);
    await click(control(bindings, 'Synthetic new staffing slot'));
    expect(state.value().staffingBindings).toEqual([]);
    expect(state.value().authoring).toEqual(original.authoring);
  });

  it('accepts only an entered unique opportunity identity and leaves unknown details empty', async () => {
    const original = baseContent();
    const uuid = vi.spyOn(crypto, 'randomUUID');
    const state = await opportunityEditor(original);
    await click(button(state.container, 'Add opportunity'));
    expect(button(state.container, 'Add to draft').disabled).toBe(true);
    await setValue(control(state.container, 'New opportunity identifier'), 'synthetic-seat-1');
    expect(button(state.container, 'Add to draft').disabled).toBe(true);
    await setValue(control(state.container, 'New opportunity identifier'), ' synthetic-new ');
    expect(button(state.container, 'Add to draft').disabled).toBe(true);
    expect(state.changes).toEqual([]);
    await setValue(control(state.container, 'New opportunity identifier'), 'synthetic-new');
    await click(button(state.container, 'Add to draft'));
    expect(state.value().positions.at(-1)).toMatchObject({
      id: 'synthetic-new',
      positionName: '',
      station: '',
      unit: '',
      division: '',
    });
    expect(state.value().rules).toEqual(original.rules);
    expect(state.value().participation).toEqual(original.participation);
    expect(state.value().staffingBindings).toEqual(original.staffingBindings);
    expect(uuid).not.toHaveBeenCalled();
  });
});

describe('BidPolicyFields', () => {
  it('synchronizes configured policy and its source document without changing any independent material', async () => {
    const original = baseContent();
    const state = policyEditor(original);
    await setValue(
      control(state.container, 'Policy reference or revision'),
      'Synthetic amended authority',
    );
    const expected = structuredClone(original);
    live(expected).policyRevision = 'Synthetic amended authority';
    required(expected.policy).executionPolicy.policyRevision = 'Synthetic amended authority';
    expect(state.value()).toEqual(expected);
  });

  it('does not create a source document during a policy edit; explicit Add starts source language empty', async () => {
    const original = { ...baseContent(), policy: null };
    const state = policyEditor(original);
    await setValue(
      control(state.container, 'Policy reference or revision'),
      'Synthetic new policy reference',
    );
    expect(state.value().policy).toBeNull();
    await click(button(state.container, 'Add policy language'));
    expect(state.value().policy).toEqual({ policyText: '', executionPolicy: live(state.value()) });
  });

  it('preserves absent personnel date across unrelated edits and only adds/removes it explicitly', async () => {
    const original = baseContent();
    const state = policyEditor(original, 'timing');
    await setValue(control(state.container, 'Turn timer (seconds)'), '200');
    expect(state.value().settings).not.toHaveProperty('personnelEvaluationOn');
    await click(control(state.container, 'Use a separate personnel evaluation date'));
    expect(state.value().settings).toHaveProperty('personnelEvaluationOn', '');
    await setValue(control(state.container, 'Personnel evaluation date'), '2027-03-01');
    await click(control(state.container, 'Use a separate personnel evaluation date'));
    expect(state.value().settings).not.toHaveProperty('personnelEvaluationOn');
    expect(live(state.value())).toEqual(live(original));
    expect(state.value().settings).toHaveProperty('credentialEvaluationOn', '2027-01-15');
  });

  it('preserves contact null and optional evidence absence until their controls are explicitly changed', async () => {
    const original = baseContent();
    const state = policyEditor(original, 'contact');
    await setValue(control(state.container, 'Minimum contact attempts'), '3');
    expect(ops(state.value()).contact).toEqual({
      minimumAttempts: 3,
      timingMode: 'OPERATOR_DISCRETION',
      durationSeconds: null,
    });
    await click(control(state.container, 'Specify a contact duration'));
    expect(ops(state.value()).contact).toHaveProperty('durationSeconds', 0);
    expect(ops(state.value()).contact).not.toHaveProperty('evidenceRequired');
    await click(control(state.container, 'Require contact evidence'));
    expect(ops(state.value()).contact).toHaveProperty('evidenceRequired', true);
    await click(control(state.container, 'Require contact evidence'));
    await click(control(state.container, 'Specify a contact duration'));
    expect(ops(state.value()).contact).toEqual({
      minimumAttempts: 3,
      timingMode: 'OPERATOR_DISCRETION',
      durationSeconds: null,
      evidenceRequired: false,
    });
    expect(state.value().policy?.executionPolicy).toEqual(live(state.value()));
    expect(ops(state.value()).aDay).toEqual(ops(original).aDay);
  });

  it('initializes operating policy with no invented members, grants, stages, authority or dates', async () => {
    const original = baseContent();
    original.policy = null;
    original.settings = {
      v: 2,
      expectedDurationDays: 3,
      turnTimerSeconds: 240,
      credentialEvaluationOn: '2027-01-15',
      personnelEvaluationOn: '2027-02-01',
    };
    const state = policyEditor(original, 'flow');
    expect(state.changes).toEqual([]);
    await click(button(state.container, 'Configure operating policy'));
    const policy = live(state.value());
    expect(state.value().settings).toMatchObject({
      v: 3,
      expectedDurationDays: 3,
      turnTimerSeconds: 240,
      credentialEvaluationOn: '2027-01-15',
      personnelEvaluationOn: '2027-02-01',
    });
    expect(policy.stages).toEqual([]);
    expect(policy.policyRevision).toBe('');
    expect(policy.actionPermissions.map((grant) => grant.actorMemberIds)).toEqual(
      Array.from({ length: LiveBidActionSchema.options.length }, () => []),
    );
    expect(policy).not.toHaveProperty('annualOperations');
    expect(policy.specialtyCatalogReference).toBeNull();
    expect(state.value().policy).toBeNull();
    expect(state.value().authoring).toEqual(original.authoring);
  });

  it('initializes procedures only on request, preserving existing policy and explicit stage order', async () => {
    const original = baseContent();
    const { annualOperations: _prior, ...withoutOperations } = live(original);
    if (original.settings?.v !== 3) throw new Error('Expected V3 settings');
    original.settings.livePolicy = withoutOperations;
    required(original.policy).executionPolicy = structuredClone(live(original));
    const state = policyEditor(original, 'contact');
    expect(state.changes).toEqual([]);
    await click(button(state.container, 'Add operating procedures'));
    const added = ops(state.value());
    expect(added.stageOrder).toEqual(['stage-one', 'stage-two']);
    expect(added.requiredTopologyPositionIds).toEqual([]);
    expect(added.contact).toEqual({
      minimumAttempts: 0,
      timingMode: 'OPERATOR_DISCRETION',
      durationSeconds: null,
    });
    expect(added).not.toHaveProperty('specialties');
    const { annualOperations: _added, ...rest } = live(state.value());
    expect(rest).toEqual(live(original));
    expect(state.value().policy?.executionPolicy).toEqual(live(state.value()));
  });

  it('reorders/removes stage identities consistently while preserving members and references needing explicit repair', async () => {
    const original = baseContent();
    required(original.policy).stageParticipantSources = [
      {
        stageId: 'stage-two',
        sourceRef: 'Synthetic second-stage participant authority',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [902] },
        ordering: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
      },
    ];
    const state = policyEditor(original, 'flow');
    const later = Array.from(state.container.querySelectorAll('details')).find((node) =>
      node.querySelector('summary')?.textContent?.includes('Synthetic second stage'),
    );
    if (!later) throw new Error('Missing second stage');
    expect(group(state.container, 'Participants in Synthetic first stage').textContent).toContain(
      'The current frozen execution schema retains these explicit references separately.',
    );
    expect(
      group(later, 'Legacy explicit participant references in Synthetic second stage').textContent,
    ).toContain('Retained legacy compatibility data only.');
    await click(button(later, 'Move stage earlier'));
    expect(live(state.value()).stages).toEqual([
      { ...live(original).stages[1], order: 0 },
      { ...live(original).stages[0], order: 1 },
    ]);
    expect(ops(state.value()).stageOrder).toEqual(['stage-two', 'stage-one']);
    expect(ops(state.value()).contact).toEqual(ops(original).contact);
    await click(button(later, 'Remove stage from draft'));
    expect(live(state.value()).stages.map((row) => row.id)).toEqual(['stage-one']);
    expect(ops(state.value()).stageOrder).toEqual(['stage-one']);
    expect(state.value().policy).not.toHaveProperty('stageParticipantSources');
    expect(live(state.value()).dispositions).toEqual(live(original).dispositions);
    expect(state.value().policy?.executionPolicy).toEqual(live(state.value()));
  });

  it('stores a valid selector and unverified comparator request as authoring material only', async () => {
    const original = baseContent();
    original.sourceDecisions[0] = {
      ...required(original.sourceDecisions[0]),
      area: 'annual-policy',
      title: 'Synthetic governing comparator decision',
    };
    const sourceDecision = structuredClone(required(original.sourceDecisions[0]));
    const state = policyEditor(original, 'flow');
    const stage = Array.from(state.container.querySelectorAll('details')).find((node) =>
      node.querySelector('summary')?.textContent?.includes('Synthetic first stage'),
    );
    if (!stage) throw new Error('Missing first stage');

    await setValue(control(state.container, 'Governing source decision'), sourceDecision.issueId);
    await setValue(control(state.container, 'Primary comparator key'), 'RSC_SENIORITY');
    await setValue(control(state.container, 'Primary comparator direction'), 'ASC');
    await click(button(state.container, 'Save governing comparator request'));
    await setValue(control(stage, 'Source reference'), 'Synthetic participant source authority');
    await setValue(control(stage, 'Explicit member IDs'), '901, 999');
    await click(button(stage, 'Save participant source'));

    expect(state.value().policy?.orderingAuthority).toEqual({
      v: 1,
      sourceDecisionId: sourceDecision.issueId,
      comparator: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
    });
    expect(state.value().policy?.stageParticipantSources).toEqual([
      {
        stageId: 'stage-one',
        sourceRef: 'Synthetic participant source authority',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [901, 999] },
        ordering: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
      },
    ]);
    expect(state.value().sourceDecisions).toEqual([sourceDecision]);
    expect(live(state.value())).toEqual(live(original));
    expect(state.value().policy?.executionPolicy).toEqual(live(original));
    expect(state.container.textContent).toContain(
      'Selector coverage is partial. Synthetic second stage',
    );
    expect(state.container.textContent).toContain(
      'Saving one stage here does not accept a version or authorize Live.',
    );
  });

  it('keeps Filter and explicit selector drafts local for a freshly added empty stage', async () => {
    const original = baseContent();
    original.sourceDecisions[0] = {
      ...required(original.sourceDecisions[0]),
      area: 'annual-policy',
      title: 'Synthetic governing comparator decision',
    };
    const state = policyEditor(original, 'flow');

    await setValue(
      control(state.container, 'Governing source decision'),
      required(original.sourceDecisions[0]).issueId,
    );
    await setValue(control(state.container, 'Primary comparator key'), 'RSC_SENIORITY');
    await setValue(control(state.container, 'Primary comparator direction'), 'ASC');
    await click(button(state.container, 'Save governing comparator request'));
    await click(button(state.container, 'Add stage'));
    const emptyStage = Array.from(state.container.querySelectorAll('details')).find((node) =>
      node.querySelector('summary')?.textContent?.includes('Stage name required'),
    );
    if (!emptyStage) throw new Error('Missing newly added stage');

    await setValue(control(emptyStage, 'Participant source type'), 'FILTER');
    await setValue(control(emptyStage, 'Source reference'), 'Synthetic new-stage authority');
    await click(control(emptyStage, 'FF'));
    expect(button(emptyStage, 'Save participant source').disabled).toBe(true);
    await setValue(control(emptyStage, 'Participant source type'), 'EXPLICIT_MEMBERS');
    await setValue(control(emptyStage, 'Explicit member IDs'), '901');
    expect(button(emptyStage, 'Save participant source').disabled).toBe(true);
    expect(emptyStage.textContent).toContain(
      'This stage has no explicit frozen participant references',
    );
    expect(live(state.value()).stages.at(-1)?.memberIds).toEqual([]);
    expect(state.value().policy).not.toHaveProperty('stageParticipantSources');
    expect(state.container.textContent).toContain(
      'Frozen execution participant references are absent',
    );
    await click(control(emptyStage, 'Synthetic member 901'));
    expect(live(state.value()).stages.at(-1)?.memberIds).toEqual([901]);
    expect(button(emptyStage, 'Save participant source').disabled).toBe(false);
    await click(button(emptyStage, 'Save participant source'));
    expect(state.value().policy?.stageParticipantSources).toEqual([
      {
        stageId: required(live(state.value()).stages.at(-1)).id,
        sourceRef: 'Synthetic new-stage authority',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [901] },
        ordering: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
      },
    ]);
  });

  it('marks every mismatched saved selector stale after an explicit comparator request change', async () => {
    const original = baseContent();
    original.sourceDecisions[0] = {
      ...required(original.sourceDecisions[0]),
      area: 'annual-policy',
      title: 'Synthetic governing comparator decision',
    };
    const oldOrdering = [{ key: 'RSC_SENIORITY' as const, direction: 'ASC' as const }];
    required(original.policy).orderingAuthority = {
      v: 1,
      sourceDecisionId: required(original.sourceDecisions[0]).issueId,
      comparator: oldOrdering,
    };
    required(original.policy).stageParticipantSources = [
      {
        stageId: 'stage-one',
        sourceRef: 'Synthetic first-stage participant authority',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [901, 999] },
        ordering: oldOrdering,
      },
      {
        stageId: 'stage-two',
        sourceRef: 'Synthetic second-stage participant authority',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [902] },
        ordering: oldOrdering,
      },
    ];
    const savedSources = structuredClone(
      required(required(original.policy).stageParticipantSources),
    );
    const state = policyEditor(original, 'flow');
    const firstStage = Array.from(state.container.querySelectorAll('details')).find((node) =>
      node.querySelector('summary')?.textContent?.includes('Synthetic first stage'),
    );
    if (!firstStage) throw new Error('Missing first stage');

    expect(state.container.textContent).toContain(
      'Typed selector sources cover every configured stage locally.',
    );
    await setValue(control(state.container, 'Primary comparator key'), 'RANK_SENIORITY');
    await click(button(state.container, 'Save governing comparator request'));

    expect(state.value().policy?.stageParticipantSources).toEqual(savedSources);
    expect(state.container.textContent).toContain(
      'Selector coverage is partial. Synthetic first stage, Synthetic second stage have no matching saved typed source.',
    );
    expect(state.container.textContent).toContain(
      'Saved selector ordering is stale for Synthetic first stage, Synthetic second stage and must be reviewed and re-saved.',
    );
    expect(firstStage.textContent).toContain('Saved selector ordering is stale and unresolved');
    expect(button(firstStage, 'Save participant source').disabled).toBe(true);

    await click(button(firstStage, 'Review current governing comparator'));
    await click(button(firstStage, 'Save participant source'));
    expect(state.value().policy?.stageParticipantSources).toEqual([
      { ...savedSources[0], ordering: [{ key: 'RANK_SENIORITY', direction: 'ASC' }] },
      savedSources[1],
    ]);
    expect(state.container.textContent).toContain(
      'Selector coverage is partial. Synthetic second stage',
    );
  });

  it('retains typed selectors but marks them unbound and Live-blocked when the request is removed', async () => {
    const original = baseContent();
    original.sourceDecisions[0] = {
      ...required(original.sourceDecisions[0]),
      area: 'annual-policy',
      title: 'Synthetic governing comparator decision',
    };
    const ordering = [{ key: 'RSC_SENIORITY' as const, direction: 'ASC' as const }];
    required(original.policy).orderingAuthority = {
      v: 1,
      sourceDecisionId: required(original.sourceDecisions[0]).issueId,
      comparator: ordering,
    };
    required(original.policy).stageParticipantSources = [
      {
        stageId: 'stage-one',
        sourceRef: 'Synthetic first-stage participant authority',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [901, 999] },
        ordering,
      },
    ];
    const savedSources = structuredClone(
      required(required(original.policy).stageParticipantSources),
    );
    const state = policyEditor(original, 'flow');
    const firstStage = Array.from(state.container.querySelectorAll('details')).find((node) =>
      node.querySelector('summary')?.textContent?.includes('Synthetic first stage'),
    );
    if (!firstStage) throw new Error('Missing first stage');

    await click(button(state.container, 'Remove governing comparator request'));

    expect(state.value().policy).not.toHaveProperty('orderingAuthority');
    expect(state.value().policy?.stageParticipantSources).toEqual(savedSources);
    expect(state.container.textContent).toContain('retained but unbound and Live-blocked');
    expect(firstStage.textContent).toContain(
      'A saved governing comparator request is required before a participant source can be saved.',
    );
    expect(button(firstStage, 'Save participant source').disabled).toBe(true);
  });

  it('does not claim full selector coverage when an orphan source remains saved', () => {
    const original = baseContent();
    original.sourceDecisions[0] = {
      ...required(original.sourceDecisions[0]),
      area: 'annual-policy',
      title: 'Synthetic governing comparator decision',
    };
    const ordering = [{ key: 'RSC_SENIORITY' as const, direction: 'ASC' as const }];
    required(original.policy).orderingAuthority = {
      v: 1,
      sourceDecisionId: required(original.sourceDecisions[0]).issueId,
      comparator: ordering,
    };
    required(original.policy).stageParticipantSources = [
      {
        stageId: 'stage-one',
        sourceRef: 'Synthetic first-stage participant authority',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [901, 999] },
        ordering,
      },
      {
        stageId: 'stage-two',
        sourceRef: 'Synthetic second-stage participant authority',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [902] },
        ordering,
      },
      {
        stageId: 'removed-stage',
        sourceRef: 'Synthetic orphan participant authority',
        participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [902] },
        ordering,
      },
    ];
    const state = policyEditor(original, 'flow');

    expect(state.value().policy?.stageParticipantSources?.map((source) => source.stageId)).toEqual([
      'stage-one',
      'stage-two',
      'removed-stage',
    ]);
    expect(state.container.textContent).toContain('Selector coverage is partial.');
    expect(state.container.textContent).toContain(
      'Unexpected saved source stage IDs: removed-stage.',
    );
    expect(state.container.textContent).not.toContain(
      'Typed selector sources cover every configured stage locally.',
    );
  });

  it('keeps a missing return stage visible and edits the returns/id pair atomically', async () => {
    const original = baseContent();
    const deferred = required(
      live(original).dispositions.find((row) => row.disposition === 'DEFER'),
    );
    deferred.returnStageId = 'missing-stage';
    required(original.policy).executionPolicy = structuredClone(live(original));
    const state = policyEditor(original, 'contact');
    const panel = Array.from(state.container.querySelectorAll('details')).find(
      (node) => node.querySelector('summary')?.textContent?.trim() === 'DEFER',
    );
    if (!panel) throw new Error('Missing disposition');
    const field = control(panel, 'Return stage');
    expect(field).toHaveProperty('value', 'missing-stage');
    expect(field.textContent).toContain('missing-stage · Missing stage');
    await setValue(field, 'stage-one');
    expect(live(state.value()).dispositions.find((row) => row.disposition === 'DEFER')).toEqual({
      ...deferred,
      returns: true,
      returnStageId: 'stage-one',
    });
    await setValue(field, '');
    expect(live(state.value()).dispositions.find((row) => row.disposition === 'DEFER')).toEqual({
      ...deferred,
      returns: false,
      returnStageId: null,
    });
  });

  it('preserves unknown specialty credentials, sibling evidence and optional scoring absence during edits', async () => {
    const original = baseContent();
    const state = policyEditor(original, 'specialties');
    expect(control(state.container, 'Scored qualification')).toHaveProperty('value', MISSING);
    await setValue(control(state.container, 'Specialty points'), '7');
    await setValue(control(state.container, 'Required specialty evidence 1'), 'SYNTHETIC_AMENDED');
    const expected = structuredClone(required(ops(original).specialties?.[0]));
    required(expected.points[0]).value = 7;
    expected.requiredSpecialtyCodes[0] = 'SYNTHETIC_AMENDED';
    expect(ops(state.value()).specialties).toEqual([expected]);
    expect(ops(state.value()).specialties?.[0]).not.toHaveProperty('scoring');
    expect(ops(state.value()).specialties?.[0]).not.toHaveProperty('rankingChannel');
  });

  it('returns grouped specialty scoring to flat only on explicit removal, preserving identity and every non-scoring field', async () => {
    const original = baseContent();
    const specialty = required(ops(original).specialties?.[0]);
    specialty.points = [];
    specialty.scoring = advancedScoring();
    specialty.rankingChannel = 'so';
    required(original.policy).executionPolicy = structuredClone(live(original));
    const state = policyEditor(original, 'specialties');
    const review = Array.from(state.container.querySelectorAll('summary')).find(
      (node) => node.textContent?.trim() === 'Review return to flat specialty scoring',
    );
    if (!review) throw new Error('Missing explicit return-to-flat review');
    await click(review);
    expect(state.changes).toEqual([]);
    await click(button(state.container, 'Remove grouped specialty scoring'));
    const { scoring: _scoring, rankingChannel: _channel, ...expected } = specialty;
    expect(ops(state.value()).specialties).toEqual([expected]);
    expect(ops(state.value()).specialties?.[0]).not.toHaveProperty('scoring');
    expect(ops(state.value()).specialties?.[0]).not.toHaveProperty('rankingChannel');
    expect(state.value().policy?.executionPolicy).toEqual(live(state.value()));
    expect(state.value().authoring).toEqual(original.authoring);
  });
});
