// @vitest-environment jsdom
import {
  type BidDefinitionContent,
  BidDefinitionContentSchema,
  BidDispositionSchema,
  type BidImpactResponse,
  BidImpactResponseSchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateEligibility,
  evaluateEligibilityWithTrace,
} from '../../../../packages/eligibility/src/evaluate';
import { compareWithTrace } from '../../../../packages/eligibility/src/tie-break';
import type { Member, PositionRule } from '../../../../packages/eligibility/src/types';
import { BidImpactReview } from '../../app/admin/current-bid/BidImpactReview';
import type { BidExpected } from '../../app/admin/current-bid/bid-client';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const YEAR = 2027;
const BASE = 'a'.repeat(64);
const DRAFT = 'b'.repeat(64);
const IMPACT = 'c'.repeat(64);
const CSRF = 'csrf_11111111-1111-4111-8111-111111111111';
const QUALIFICATION = 'Synthetic rescue qualification';
type Result = Extract<BidImpactResponse, { valid: true }>;
type Selection = NonNullable<Result['trace']>['selection'];
type RequestBody = {
  kind: 'impact';
  expected: BidExpected;
  intent: { operation: 'save'; content: BidDefinitionContent };
  mode: 'mock' | 'live';
  changeOffset: number;
  expectedImpactSha256?: string;
  trace?: Selection;
};
type RequestEntry = { path: string; method: string; body: RequestBody; headers: Headers };
const expected: BidExpected = {
  kind: 'version',
  versionId: 'synthetic-version-2',
  revision: 2,
  sha256: BASE,
};
const seat = (index: number) => `synthetic-seat-${String(index + 1).padStart(4, '0')}`;
const person = (index: number) => `Synthetic person ${String(index + 1).padStart(4, '0')}`;
const memberId = (index: number) => 10001 + index;

function material(size = 3): BidDefinitionContent {
  const livePolicy = {
    v: 1,
    policyRevision: 'synthetic-policy',
    stages: [
      {
        id: 'synthetic-stage',
        label: 'Synthetic first stage',
        order: 0,
        kind: 'FIREFIGHTER',
        memberIds: Array.from({ length: size }, (_, index) => memberId(index)),
        opportunityPositionIds: Array.from({ length: size }, (_, index) => seat(index)),
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
      actorMemberIds: [memberId(0)],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
  };
  return BidDefinitionContentSchema.parse({
    v: 1,
    bidYear: YEAR,
    settings: {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      personnelEvaluationOn: '2027-01-01',
      livePolicy,
    },
    notes: { bid: 'Synthetic unsaved policy', positions: null },
    policy: { policyText: 'Synthetic reviewed language', executionPolicy: livePolicy },
    planning: null,
    authoring: null,
    positions: Array.from({ length: size }, (_, index) => ({
      id: seat(index),
      positionName: `Synthetic opportunity ${index + 1}`,
      shift: 'A',
      station: '7',
      unit: 'Synthetic Engine',
      division: 'Combat',
      rankRequired: 'FF',
      isExcludedFromCount: false,
      isFloating: false,
      isVacantByDesign: false,
    })),
    rules: Array.from({ length: size }, (_, index) => ({
      positionId: seat(index),
      requiredCriteriaJson: JSON.stringify({ rank: ['FF'], credentials: [], custom: [] }),
      pointsPreferenceJson: JSON.stringify({
        max: 2,
        items: [{ credential: QUALIFICATION, points: 2, requiresOpsPair: false }],
      }),
      tieBreakChainJson: '["points","rsc_seniority"]',
      notes: null,
    })),
    participation: [],
    staffingBindings: [],
    sourceDecisions: [],
  });
}
function rule(points: number, positionId = seat(0)): PositionRule {
  return {
    positionId,
    ruleBookVersion: 'synthetic-only',
    requiredCriteria: { rank: ['FF'], credentials: [], custom: [] },
    pointsPreference: {
      max: points,
      items: [{ credential: QUALIFICATION, points, requiresOpsPair: false }],
    },
    tieBreakChain: ['points', 'rsc_seniority'],
  };
}
function evidence(id: number): Member {
  return {
    memberId: id,
    employeeId: `synthetic-${id}`,
    firstName: 'Synthetic',
    lastName: `Person ${id}`,
    rank: 'FF',
    rscSeniority: id - 10000,
    rankSeniority: id - 10000,
    isProbationary: false,
    credentials: [{ name: QUALIFICATION }],
  };
}
function decision(
  selection: Selection,
  points: number,
): Extract<NonNullable<Result['trace']>['after'], { status: 'EVALUATED' }> {
  const member = evidence(selection.memberId);
  const selectedRule = rule(points, selection.positionId);
  const { result, channels } = evaluateEligibilityWithTrace(member, selectedRule);
  const other =
    selection.compareMemberId === undefined ? null : evidence(selection.compareMemberId);
  const otherResult = other ? evaluateEligibility(other, selectedRule) : null;
  return {
    status: 'EVALUATED',
    pool: {
      pool: 'FF',
      exclusionReason: null,
      authoritativeAssignmentId: null,
      mockParticipationEvidence: null,
    },
    eligible: result.eligible,
    reasons: result.reasons,
    points: result.points,
    soPoints: result.soPoints,
    moPoints: result.moPoints,
    breakdown: result.breakdown,
    channels,
    priority: selection.memberId - 10000,
    tieBreakChain: selectedRule.tieBreakChain,
    comparison:
      other && otherResult
        ? compareWithTrace(
            { ...result, rscSeniority: member.rscSeniority, rankSeniority: member.rscSeniority },
            { ...otherResult, rscSeniority: other.rscSeniority, rankSeniority: other.rscSeniority },
            selectedRule.tieBreakChain,
          )
        : null,
    comparisonUnavailableReason: null,
    stage: { id: 'synthetic-stage', opportunityAllowed: true },
    postAward: [],
    evidence: {
      rank: 'FF',
      isProbationary: false,
      credentialNames: [QUALIFICATION],
      scoringEvidence: null,
      serviceCredits: [],
    },
  };
}
function score(id: number, points: number) {
  const result = evaluateEligibility(evidence(id), rule(points));
  return {
    eligible: result.eligible,
    points: result.points,
    soPoints: result.soPoints,
    moPoints: result.moPoints,
    priority: id - 10000,
    reasons: result.reasons.filter((reason) => !reason.satisfied).map((reason) => reason.label),
  };
}
// This is a synthetic server DTO, not a second eligibility evaluator. Trace/score
// values come from the real engine; the strict shared schema parses every response.
function resultFor(body: RequestBody, population = body.intent.content.positions.length): Result {
  const members = Array.from({ length: population }, (_, index) => ({
    memberId: memberId(index),
    displayName: person(index),
    rank: 'FF' as const,
    pool: 'FF' as const,
    exclusionReason: null,
    authoritativeAssignmentId: null,
    mockParticipationEvidence: null,
  }));
  const side = {
    status: 'EVALUATED',
    contextSha256: 'd'.repeat(64),
    executionReferenceErrors: [],
    personnelEvaluationOn: '2027-01-01',
    credentialEvaluationOn: '2027-01-01',
    members,
    opportunities: body.intent.content.positions.map((position) => ({
      positionId: position.id,
      evaluatedMemberCount: population,
      eligibleMemberCount: population,
    })),
    stageOrder: {
      status: 'EVALUATED',
      codes: [],
      entries: members.map((member, index) => ({
        ordinal: index + 1,
        memberId: member.memberId,
        stageId: 'synthetic-stage',
      })),
    },
    specialties: [],
    selectionConsequences: {
      status: 'REQUIRES_SELECTION_CONTEXT',
      areas: ['A_DAY_CAPACITY', 'NEXT_BIDDER', 'SPECIALTY_INTERRUPTION', 'POSITION_AWARDS'],
    },
  };
  const changes = members.map((member) => ({
    cause: 'POLICY',
    memberId: member.memberId,
    positionId: seat(0),
    before: score(member.memberId, 1),
    after: score(member.memberId, 2),
  }));
  const empty = { addedIds: [], removedIds: [], changedIds: [] };
  const value = BidImpactResponseSchema.parse({
    valid: true,
    v: 1,
    bidYear: YEAR,
    source: { kind: 'UNSAVED_DRAFT', baselineContentSha256: BASE, candidateContentSha256: DRAFT },
    mode: body.mode,
    capturedAtMs: 1799000000000,
    runtimeSourceToken: 'e'.repeat(64),
    impactSha256: IMPACT,
    before: side,
    after: structuredClone(side),
    comparison: {
      status: 'EVALUATED',
      affectedMemberIds: members.map((member) => member.memberId),
      unavailableAreas: [],
      eligibility: {
        policyComparisonCount: population,
        evidenceComparisonCount: population,
        policyChangeCount: population,
        evidenceChangeCount: 0,
        changeCount: population,
        changeOffset: body.changeOffset,
        changes: changes.slice(body.changeOffset, body.changeOffset + 100),
        nextChangeOffset: body.changeOffset + 100 < population ? body.changeOffset + 100 : null,
        incomparable: {
          addedMemberIds: [],
          removedMemberIds: [],
          addedPositionIds: [],
          removedPositionIds: [],
        },
      },
      poolChanges: [],
      stageChanges: [],
      stageOpportunityChanges: [],
      specialtyChanges: [],
    },
    trace: body.trace
      ? { selection: body.trace, before: decision(body.trace, 1), after: decision(body.trace, 2) }
      : null,
    diff: {
      positions: empty,
      rules: empty,
      participation: empty,
      staffingBindings: empty,
      sourceDecisions: empty,
      changedSections: ['rules'],
    },
  });
  if (!value.valid) throw new Error('Synthetic valid result failed');
  return value;
}
function evaluated(side: Result['before']) {
  if (side.status !== 'EVALUATED') throw new Error('Synthetic side is blocked');
  return side;
}
function comparison(result: Result) {
  if (result.comparison.status !== 'EVALUATED') throw new Error('Synthetic comparison unavailable');
  return result.comparison;
}
function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('Missing synthetic fixture/control');
  return value;
}
let root: Root | undefined;
let container: HTMLDivElement;
let props: Parameters<typeof BidImpactReview>[0];
let requests: RequestEntry[];
let handle: (
  body: RequestBody,
) => BidImpactResponse | Response | Promise<BidImpactResponse | Response>;
let originalWindowFetch: typeof fetch;
const begin = vi.fn(() => true);
const finish = vi.fn();
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  requests = [];
  begin.mockReset().mockReturnValue(true);
  finish.mockReset();
  handle = resultFor;
  originalWindowFetch = window.fetch;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (path === '/api/auth/csrf') return response({ token: CSRF });
    if (path !== `/api/admin/bid/${YEAR}/preview`)
      throw new Error(`Unexpected API request ${path}`);
    const entry = {
      path,
      method: init?.method ?? 'GET',
      body: JSON.parse(String(init?.body)) as RequestBody,
      headers: new Headers(init?.headers),
    };
    requests.push(entry);
    const value = await handle(entry.body);
    return value instanceof Response ? value : response(BidImpactResponseSchema.parse(value));
  });
  vi.stubGlobal('fetch', fetcher);
  window.fetch = fetcher;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  for (const request of requests) {
    expect(request.path).toBe(`/api/admin/bid/${YEAR}/preview`);
    expect(request.method).toBe('POST');
    expect(request.body.kind).toBe('impact');
    expect(request.headers.get('Idempotency-Key')).toBeNull();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.fetch = originalWindowFetch;
  document.body.replaceChildren();
});
async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(content = material()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  props = { content, expected, year: YEAR, locked: false, begin, finish };
  await rerender();
}
async function rerender(next: Partial<typeof props> = {}) {
  props = { ...props, ...next };
  await settle(() => root?.render(<BidImpactReview {...props} />));
}
function button(text: string, scope: HTMLElement = container): HTMLButtonElement {
  return required(
    [...scope.querySelectorAll('button')].find((node) => node.textContent?.trim() === text),
  );
}
function details(text: string): HTMLDetailsElement {
  return required(
    [...container.querySelectorAll('details')].find(
      (node) => node.querySelector(':scope > summary')?.textContent?.trim() === text,
    ),
  );
}
function section(text: string): HTMLElement {
  return required(
    [...container.querySelectorAll('section')].find(
      (node) => node.querySelector(':scope > header > h3')?.textContent === text,
    ),
  );
}
function fieldset(text: string): HTMLFieldSetElement {
  return required(
    [...container.querySelectorAll('fieldset')].find(
      (node) => node.querySelector(':scope > legend')?.textContent === text,
    ),
  );
}
function field(text: string): HTMLInputElement | HTMLSelectElement {
  const labels = [...container.querySelectorAll('label')];
  const label = required(labels.find((node) => node.textContent?.trim() === text));
  const node = label.htmlFor
    ? document.getElementById(label.htmlFor)
    : label.querySelector('input');
  if (!(node instanceof HTMLInputElement || node instanceof HTMLSelectElement))
    throw new Error(`Missing field ${text}`);
  return node;
}
async function change(text: string, value: string) {
  await settle(() => {
    const node = field(text);
    const prototype =
      node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function click(text: string, scope: HTMLElement = container) {
  await settle(() => button(text, scope).click());
}
async function evaluate() {
  await click('Evaluate draft impact');
}

describe('Current Bid server impact review', () => {
  it('browses the authored flow without requesting a calculation, and honors the external execution lock', async () => {
    await mount();
    expect(container.textContent).toContain('Synthetic first stage');
    expect(requests).toEqual([]);
    await rerender({ locked: true });
    expect(button('Evaluate draft impact').disabled).toBe(true);
    await evaluate();
    expect(requests).toEqual([]);
    await rerender({ locked: false });
    begin.mockReturnValue(false);
    await evaluate();
    expect(requests).toEqual([]);
    expect(finish).not.toHaveBeenCalled();
  });

  it('sends the complete unsaved draft only as a read-only impact preview and releases its execution lock', async () => {
    const content = material();
    const before = structuredClone(content);
    await mount(content);
    await evaluate();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual({
      kind: 'impact',
      expected,
      intent: { operation: 'save', content },
      mode: 'mock',
      changeOffset: 0,
    });
    expect(content).toEqual(before);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('3 people with evaluated changes.');
    expect(container.textContent).toContain('without changing Department records');
    expect(container.textContent).toContain('These outcomes have not been predicted');
  });

  it('separates Mock concessions from Live results and hides the previous mode until recalculated', async () => {
    handle = (body) => {
      const result = resultFor(body);
      if (body.mode === 'mock') {
        evaluated(result.after).members[0] = {
          ...required(evaluated(result.after).members[0]),
          mockParticipationEvidence: 'ACCEPTED_STAFFING_BASELINE',
        };
      } else {
        evaluated(result.after).members[0] = {
          ...required(evaluated(result.after).members[0]),
          pool: 'EXCLUDED',
          exclusionReason: 'MEMBER_EMPLOYMENT_UNCONFIRMED',
          mockParticipationEvidence: null,
        };
      }
      return result;
    };
    await mount();
    await evaluate();
    expect(section('Unsaved draft').textContent).toContain('3 participants');
    await change('Participation for this calculation', 'live');
    expect(container.textContent).toContain('Evaluate it again for current results');
    expect(container.textContent).not.toContain('3 people with evaluated changes');
    expect(requests).toHaveLength(1);
    await evaluate();
    expect(requests[1]?.body.mode).toBe('live');
    expect(requests[1]?.body).not.toHaveProperty('expectedImpactSha256');
    expect(section('Unsaved draft').textContent).toContain('2 participants · 1 excluded');
  });

  it('shows blocked-side reasons and missing opportunity results without fabricating zero eligibility', async () => {
    handle = (body) => {
      const result = resultFor(body);
      result.after = {
        status: 'BLOCKED',
        code: 'tenure_evidence_requires_review',
        positionIds: [seat(0)],
        tenureIssues: [
          {
            staffingPositionId: 'synthetic-unreviewed-slot',
            recordId: 'synthetic-tenure',
            code: 'TENURE_UNKNOWN',
          },
        ],
      };
      result.comparison = { status: 'UNAVAILABLE', code: 'both_definitions_must_be_evaluable' };
      result.impactSha256 = null;
      return result;
    };
    await mount();
    await evaluate();
    const draft = section('Unsaved draft');
    expect(draft.textContent).toContain('Review tenure evidence');
    expect(draft.textContent).toContain('synthetic-unreviewed-slot');
    expect(draft.textContent).not.toContain('0 participants');
    expect(container.querySelector('output')).toBeNull();
    expect(container.textContent).toContain('No missing result has been treated as zero');
    expect(details('Eligibility by opportunity').textContent).toContain(
      '3 → Not evaluated eligible members',
    );
    expect(details('Eligibility by opportunity').textContent).not.toContain('3 → 0');
  });

  it('hides completed results immediately after local edits or expected-head changes without another API request', async () => {
    await mount();
    await evaluate();
    const changed = structuredClone(props.content);
    changed.notes.bid = 'Synthetic local edit';
    await rerender({ content: changed });
    expect(container.querySelector('output')).toBeNull();
    expect(container.textContent).not.toContain('Rule / decision trace');
    expect(container.textContent).toContain('Evaluate it again for current results');
    expect(requests).toHaveLength(1);
    await evaluate();
    expect(container.querySelector('output')).not.toBeNull();
    await rerender({ expected: { ...expected, revision: 3, versionId: 'synthetic-version-3' } });
    expect(container.querySelector('output')).toBeNull();
    expect(requests).toHaveLength(2);
  });

  it('does not reveal an in-flight response belonging to an older local draft', async () => {
    let resolveResponse: ((value: BidImpactResponse) => void) | undefined;
    let captured: RequestBody | undefined;
    handle = (body) => {
      captured = body;
      return new Promise((resolve) => {
        resolveResponse = resolve;
      });
    };
    await mount();
    await evaluate();
    const changed = structuredClone(props.content);
    changed.notes.bid = 'New draft while request pending';
    await rerender({ content: changed });
    await settle(() => required(resolveResponse)(resultFor(required(captured))));
    expect(container.querySelector('output')).toBeNull();
    expect(container.textContent).toContain('Evaluate it again for current results');
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('binds forward/back change pages and row traces to the evaluated hash across 501 members', async () => {
    await mount(material(501));
    await evaluate();
    const changed = details('Changed eligibility and priority');
    expect(changed.querySelectorAll('li')).toHaveLength(100);
    expect(changed.textContent).toContain(person(0));
    expect(changed.textContent).not.toContain(person(100));
    await click('Next changes');
    expect(requests[1]?.body).toMatchObject({ changeOffset: 100, expectedImpactSha256: IMPACT });
    expect(details('Changed eligibility and priority').textContent).toContain(person(100));
    await click('Previous changes');
    expect(requests[2]?.body).toMatchObject({ changeOffset: 0 });
    expect(requests[2]?.body.expectedImpactSha256).toBe(IMPACT);
    for (let page = 0; page < 5; page++) await click('Next changes');
    const last = details('Changed eligibility and priority');
    expect(last.querySelectorAll('li')).toHaveLength(1);
    expect(last.textContent).toContain(person(500));
    await click('Inspect decision', last);
    expect(requests.at(-1)?.body).toMatchObject({
      changeOffset: 500,
      expectedImpactSha256: IMPACT,
      trace: { memberId: memberId(500), positionId: seat(0) },
    });
    expect(details('Changed eligibility and priority').querySelectorAll('li')).toHaveLength(1);
    expect(document.activeElement?.tagName).toBe('H3');
    expect(document.activeElement?.textContent).toContain(person(500));
    expect(document.activeElement?.textContent).toContain(seat(0));
    expect(section('Draft decision').textContent).toContain('2 points');
  });

  it('pages all 501 opportunity/member choices locally and sends exact selected trace identities', async () => {
    await mount(material(501));
    await evaluate();
    const opportunities = details('Eligibility by opportunity');
    for (let page = 0; page < 25; page++) await click('Next opportunities', opportunities);
    expect(opportunities.querySelectorAll('li')).toHaveLength(1);
    expect(opportunities.textContent).toContain(seat(500));
    expect(requests).toHaveLength(1);
    await change('Find trace member', person(500));
    await settle(() =>
      required(
        fieldset('Trace member').querySelector<HTMLInputElement>('input[type=checkbox]'),
      ).click(),
    );
    await change('Find trace opportunity', seat(500));
    await settle(() =>
      required(
        fieldset('Trace opportunity').querySelector<HTMLInputElement>('input[type=checkbox]'),
      ).click(),
    );
    await change('Find comparison member (optional)', person(0));
    await settle(() =>
      required(
        fieldset('Comparison member (optional)').querySelector<HTMLInputElement>(
          'input[type=checkbox]',
        ),
      ).click(),
    );
    const action = button('Show decision trace');
    action.focus();
    expect(document.activeElement).toBe(action);
    expect(action.tagName).toBe('BUTTON');
    expect(action.type).toBe('button');
    expect(action.disabled).toBe(false);
    await click('Show decision trace');
    expect(requests.at(-1)?.body.trace).toEqual({
      memberId: memberId(500),
      positionId: seat(500),
      compareMemberId: memberId(0),
    });
    expect(requests.at(-1)?.body.expectedImpactSha256).toBe(IMPACT);
    expect(section('Draft decision').textContent).toContain(QUALIFICATION);
    expect(section('Draft decision').textContent).toContain('Comparison member ranks first');
  });

  it('keeps a smaller newly evaluated opportunity list reachable after paging a larger result', async () => {
    await mount(material(501));
    await evaluate();
    const opportunities = details('Eligibility by opportunity');
    for (let page = 0; page < 25; page++) await click('Next opportunities', opportunities);
    await rerender({ content: material(2) });
    await evaluate();
    expect(details('Eligibility by opportunity').querySelectorAll('li')).toHaveLength(2);
    expect(details('Eligibility by opportunity').textContent).toContain(seat(0));
  });

  it('surfaces reference and specialty failures as unavailable areas while retaining evaluated eligibility', async () => {
    handle = (body) => {
      const result = resultFor(body);
      const side = evaluated(result.after);
      side.executionReferenceErrors = [
        'specialty_credential_reference_invalid',
        'action_actor_reference_invalid',
      ];
      side.stageOrder = {
        status: 'BLOCKED',
        codes: ['stage_member_reference_invalid'],
        entries: [],
      };
      side.specialties = [
        {
          id: 'synthetic-rescue',
          mode: 'INTERRUPTING',
          opportunityPositionIds: [seat(0)],
          status: 'BLOCKED',
          code: 'specialty_credential_reference_invalid',
          candidates: [],
        },
      ];
      comparison(result).unavailableAreas = ['STAGE_ORDER', 'SPECIALTY:synthetic-rescue'];
      comparison(result).stageChanges = null;
      comparison(result).specialtyChanges = [
        {
          id: 'synthetic-rescue',
          status: 'UNAVAILABLE',
          changes: [],
          addedPositionIds: [],
          removedPositionIds: [],
          modeChanged: false,
        },
      ];
      return result;
    };
    await mount();
    await evaluate();
    expect(section('Unsaved draft').textContent).toContain(
      'Operating policy references need review',
    );
    expect(section('Unsaved draft').textContent).toContain(
      'An action permission names a person absent',
    );
    expect(section('Unsaved draft').textContent).toContain('A stage contains a member outside');
    expect(section('Unsaved draft').textContent).not.toContain('0 ranked candidates');
    expect(container.textContent).toContain('affected-person count excludes results');
    expect(container.textContent).toContain('Unavailable stage-order changes');
  });

  it('retains incomparable opportunity identities and renders absent sides as not evaluated', async () => {
    handle = (body) => {
      const result = resultFor(body);
      const first = seat(0);
      const added = 'synthetic-added-seat';
      evaluated(result.after).opportunities = [
        { positionId: added, evaluatedMemberCount: 3, eligibleMemberCount: 2 },
      ];
      comparison(result).eligibility.incomparable = {
        addedMemberIds: [memberId(2)],
        removedMemberIds: [memberId(0)],
        addedPositionIds: [added],
        removedPositionIds: [first],
      };
      return result;
    };
    await mount();
    await evaluate();
    expect(container.textContent).toContain('Added opportunities: synthetic-added-seat');
    expect(container.textContent).toContain(`Removed opportunities: ${seat(0)}`);
    expect(details('Eligibility by opportunity').textContent).toContain(
      'Not evaluated → 2 eligible members',
    );
    expect(details('Eligibility by opportunity').textContent).toContain(
      '3 → Not evaluated eligible members',
    );
  });

  it('renders all three authoritative award channels including capped groups and explicit failed requirements', async () => {
    handle = (body) => {
      const result = resultFor(body);
      if (!body.trace || !result.trace) return result;
      const selectedRule = rule(0, body.trace.positionId);
      selectedRule.pointsPreference = { max: 0, items: [] };
      selectedRule.pointsPreference.scoring = {
        v: 1,
        total: [
          {
            id: 'synthetic-total',
            cap: 2,
            items: [{ credential: QUALIFICATION, points: 6, alternatives: [], requiresAll: [] }],
          },
        ],
        so: [
          {
            id: 'synthetic-so',
            cap: 1,
            items: [{ credential: QUALIFICATION, points: 4, alternatives: [], requiresAll: [] }],
          },
        ],
        mo: [
          {
            id: 'synthetic-mo',
            cap: null,
            items: [{ credential: QUALIFICATION, points: 3, alternatives: [], requiresAll: [] }],
          },
        ],
      };
      const calculated = evaluateEligibilityWithTrace(evidence(body.trace.memberId), selectedRule);
      result.trace.after = {
        ...decision(body.trace, 0),
        ...calculated.result,
        channels: calculated.channels,
      };
      const failedRule = rule(1, body.trace.positionId);
      failedRule.requiredCriteria.credentials = ['Synthetic missing required qualification'];
      const failed = evaluateEligibilityWithTrace(evidence(body.trace.memberId), failedRule);
      result.trace.before = {
        ...decision(body.trace, 1),
        ...failed.result,
        channels: failed.channels,
        priority: null,
      };
      return result;
    };
    await mount();
    await evaluate();
    await click(
      'Inspect decision',
      required(details('Changed eligibility and priority').querySelector('li')),
    );
    const draft = section('Draft decision');
    expect(draft.textContent).toContain('2 points · 1 Special Operations · 3 Marine Operations');
    const awards = required(
      [...draft.querySelectorAll('details')].find(
        (node) => node.querySelector('summary')?.textContent === 'Point awards',
      ),
    );
    expect(awards.textContent).toContain('Total: 2');
    expect(awards.textContent).toContain('Special Operations: 1');
    expect(awards.textContent).toContain('Marine Operations: 3');
    expect(awards.querySelectorAll('li')).toHaveLength(3);
    expect(section('Saved policy decision').textContent).toContain(
      'Does not meet the opportunity requirements',
    );
    expect(section('Saved policy decision').textContent).toContain('Fail:');
    expect(section('Saved policy decision').textContent).toContain(
      'Synthetic missing required qualification',
    );
  });

  it('keeps excluded-member traces unavailable without inventing point or priority results', async () => {
    handle = (body) => {
      const result = resultFor(body);
      if (result.trace)
        result.trace.after = {
          status: 'NOT_APPLICABLE',
          code: 'member_excluded_from_bid',
          pool: {
            pool: 'EXCLUDED',
            exclusionReason: 'ADMIN_ASSIGNED_NON_BIDDABLE',
            authoritativeAssignmentId: 'synthetic-assignment',
            mockParticipationEvidence: null,
          },
        };
      return result;
    };
    await mount();
    await evaluate();
    await click(
      'Inspect decision',
      required(details('Changed eligibility and priority').querySelector('li')),
    );
    const draft = section('Draft decision');
    expect(draft.textContent).toContain('member excluded from bid');
    expect(draft.textContent).not.toContain('0 points');
    expect(draft.textContent).not.toContain('Priority');
  });

  it('removes the old result on a stale-context rejection and keeps structural validation issues actionable', async () => {
    await mount(material(101));
    await evaluate();
    handle = () => response({ error: 'bid_impact_context_changed' }, 409);
    await click('Next changes');
    expect(container.querySelector('output')).toBeNull();
    expect(container.querySelector('[role=alert]')?.textContent).toContain(
      'Department evidence changed',
    );
    expect(finish).toHaveBeenCalledTimes(2);
    handle = () => ({
      valid: false,
      issues: [
        {
          path: ['rules', 0, 'requiredCriteriaJson'],
          code: 'invalid_rule',
          message: 'Synthetic missing credential reference',
        },
      ],
    });
    await evaluate();
    expect(container.textContent).toContain(
      'rules › 0 › requiredCriteriaJson: Synthetic missing credential reference',
    );
    expect(container.querySelector('output')).toBeNull();
  });
});
