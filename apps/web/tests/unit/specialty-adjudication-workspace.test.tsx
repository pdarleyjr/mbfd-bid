// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpecialtyAdjudicationWorkspace } from '../../app/admin/specialty-adjudication/SpecialtyAdjudicationWorkspace';

const roots: Root[] = [];

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  readonly sent: string[] = [];

  constructor(
    readonly url: string,
    readonly protocols: string | string[],
  ) {
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  send(data: string) {
    this.sent.push(data);
  }
}

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  FakeWebSocket.instances = [];
  vi.unstubAllGlobals();
});

function renderWorkspace(props: { wsBase?: string } = {}): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(<SpecialtyAdjudicationWorkspace {...props} />);
  });
  return container;
}

async function setValue(
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : control instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) throw new Error('Control value setter is unavailable.');
    setter.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function initialState() {
  return {
    version: 1,
    revision: 0,
    active: null,
    consumedCommandIds: [],
    processedRequestIds: [],
    resumedRequestIds: [],
  };
}

function normalTurn(mockControlRevision = 7) {
  return {
    bidder_id: 17,
    ordinal: 1,
    queue_cursor: 0,
    mock_control_revision: mockControlRevision,
  };
}

function activeState(
  revision: number,
  phase: 'resolving_higher_priority_candidates' | 'awaiting_original_bidder' | 'awaiting_resume',
) {
  const candidate = {
    memberId: 11,
    priorityRank: 1,
    generalEligibility: { status: 'eligible' },
    specialtyEligibility: { status: 'eligible' },
  };
  const original = {
    memberId: 17,
    priorityRank: 2,
    generalEligibility: { status: 'eligible' },
    specialtyEligibility: { status: 'eligible' },
  };
  return {
    version: 1,
    revision,
    active: {
      requestId: 'specialty-request-1',
      positionId: 'A101',
      policyReference: 'synthetic-specialty-fixture-v1',
      policySource: 'synthetic',
      candidateReleasePolicy: {
        status: 'configured',
        onRelease: 'continue_to_next_higher_priority',
      },
      originalTurn: { turnId: 'normal-turn-1', bidderId: 17, ordinal: 1, queueCursor: 0 },
      rankedCandidates: [candidate, original],
      candidateQueue: [candidate],
      candidateOutcomes:
        phase === 'resolving_higher_priority_candidates'
          ? []
          : [
              {
                memberId: 11,
                priorityRank: 1,
                outcome: { kind: 'release', reason: 'declined' },
              },
            ],
      candidateCursor: phase === 'resolving_higher_priority_candidates' ? 0 : 1,
      phase,
      resolution:
        phase === 'awaiting_resume'
          ? {
              kind: 'awarded',
              awardedToMemberId: 17,
              awardReference: 'synthetic-award-17',
              awardedBy: 'original_bidder',
            }
          : null,
    },
    consumedCommandIds: [],
    processedRequestIds: ['specialty-request-1'],
    resumedRequestIds: [],
  };
}

function accepted(state: unknown, operation: string, reason: string) {
  return {
    mode: 'synthetic_test_only',
    does_not_commit_bid: true,
    kind: 'accepted',
    idempotent_replay: false,
    result: { kind: operation === 'resume' ? 'resumed' : 'suspended', state, events: [] },
    audit_receipt: {
      commandId: `${operation}-command`,
      operation,
      origin: 'synthetic_specialty_test',
      reason,
      beforeState: initialState(),
      afterState: state,
      events: [],
    },
  };
}

function specialtySignal(sessionId: string, revision: number) {
  return {
    v: 1,
    type: 'synthetic_specialty_state_changed',
    mode: 'synthetic_test_only',
    does_not_commit_bid: true,
    bidSessionId: sessionId,
    revision,
    controlState: {
      rehearsalRevision: 7,
      normalTurn: {
        turnId: `mock-normal:${sessionId}:7:1:0:17`,
        bidderId: 17,
        ordinal: 1,
        queueCursor: 0,
        mockControlRevision: 7,
      },
      normalBidderSuspended: true,
      specialty: {
        active: true,
        requestId: 'specialty-request-1',
        positionId: 'A101',
        phase: 'awaiting_original_bidder',
        originalTurn: {
          turnId: `mock-normal:${sessionId}:7:1:0:17`,
          bidderId: 17,
          ordinal: 1,
          queueCursor: 0,
          mockControlRevision: 7,
        },
        candidateQueue: [{ memberId: 11, priorityRank: 1 }],
        candidateCursor: 1,
        resolvedCandidateCount: 1,
        resolution: null,
        allowedNextAction: 'resolve_original',
      },
    },
  };
}

describe('SpecialtyAdjudicationWorkspace', () => {
  it('labels the screen as a synthetic rehearsal and never as an official specialty policy', () => {
    const html = renderToString(<SpecialtyAdjudicationWorkspace />);

    expect(html).toContain('Specialty adjudication rehearsal');
    expect(html).toContain('Synthetic test only');
    expect(html).toContain('does not commit a Bid');
    expect(html).toContain('No approved specialty policy');
    expect(html).toContain('Inspect specialty state');
    expect(html).toContain('begin labelled synthetic scenario');
    expect(html).toContain('data-testid="specialty-inspect-form"');
  });

  it('surfaces the exact Worker mock-only rejection without enabling a scenario', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: 'specialty_synthetic_test_mode_only', is_mock: false }),
            {
              status: 409,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    );

    const container = renderWorkspace();
    const sessionId = container.querySelector<HTMLInputElement>('input[name="session_id"]');
    const inspectForm = container.querySelector<HTMLFormElement>(
      '[data-testid="specialty-inspect-form"]',
    );
    if (!sessionId || !inspectForm) throw new Error('Inspection controls did not render.');

    await setValue(sessionId, 'official-session-1');
    await submit(inspectForm);

    expect(container.textContent).toContain('specialty_synthetic_test_mode_only');
    expect(container.querySelector('[data-testid="specialty-begin-form"]')).toBeNull();
  });

  it('loads an empty mock state, creates only a synthetic policy command, and renders its receipt', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        const url = String(input);
        if (init?.method === 'POST') {
          return new Response(
            JSON.stringify(
              accepted(
                activeState(1, 'resolving_higher_priority_candidates'),
                'begin',
                'Run the controlled fixture.',
              ),
            ),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.endsWith('/specialty-adjudication')) {
          return new Response(
            JSON.stringify({
              mode: 'synthetic_test_only',
              does_not_commit_bid: true,
              database_audit_log: 'not_written',
              state: initialState(),
              normal_turn: normalTurn(),
              audit_receipts: [],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const container = renderWorkspace();
    const sessionId = container.querySelector<HTMLInputElement>('input[name="session_id"]');
    const inspectForm = container.querySelector<HTMLFormElement>(
      '[data-testid="specialty-inspect-form"]',
    );
    if (!sessionId || !inspectForm) throw new Error('Inspection controls did not render.');
    await setValue(sessionId, 'mock-session-1');
    await submit(inspectForm);

    const beginForm = container.querySelector<HTMLFormElement>(
      '[data-testid="specialty-begin-form"]',
    );
    const positionId = container.querySelector<HTMLInputElement>('input[name="position_id"]');
    const candidates = container.querySelector<HTMLTextAreaElement>(
      'textarea[name="candidate_rows"]',
    );
    const reason = container.querySelector<HTMLTextAreaElement>('textarea[name="begin_reason"]');
    if (!beginForm || !positionId || !candidates || !reason) {
      throw new Error('Synthetic scenario controls did not render.');
    }
    expect(
      beginForm.querySelector<HTMLInputElement>('input[name="test_policy_label"]')?.value,
    ).toBe('TEST POLICY — NOT APPROVED MBFD POLICY');
    expect(beginForm.textContent).toContain('Specialty pool');
    expect(beginForm.textContent).toContain('Required credential names');
    expect(beginForm.textContent).toContain('Required specialty qualification codes');
    expect(beginForm.textContent).toContain('Explicit test ranking');
    expect(beginForm.textContent).toContain('Lower score wins');
    expect(beginForm.textContent).toContain('Tie-break chain');
    expect(beginForm.textContent).toContain('Suspend exact normal Bid turn');
    expect(beginForm.textContent).toContain('Resume exact original Bid turn');

    const policyVersion = beginForm.querySelector<HTMLInputElement>(
      'input[name="test_policy_version"]',
    );
    const poolId = beginForm.querySelector<HTMLInputElement>('input[name="test_policy_pool_id"]');
    const poolLabel = beginForm.querySelector<HTMLInputElement>(
      'input[name="test_policy_pool_label"]',
    );
    const credentialRequirements = beginForm.querySelector<HTMLTextAreaElement>(
      'textarea[name="test_policy_credential_requirements"]',
    );
    const specialtyRequirements = beginForm.querySelector<HTMLTextAreaElement>(
      'textarea[name="test_policy_specialty_requirements"]',
    );
    const rankingReference = beginForm.querySelector<HTMLInputElement>(
      'input[name="test_policy_ranking_reference"]',
    );
    if (
      !policyVersion ||
      !poolId ||
      !poolLabel ||
      !credentialRequirements ||
      !specialtyRequirements ||
      !rankingReference
    ) {
      throw new Error('Typed synthetic test-policy controls did not render.');
    }
    await setValue(positionId, 'A101');
    await setValue(candidates, '11, 1\n17, 1');
    await setValue(policyVersion, 'synthetic-specialty-v2');
    await setValue(poolId, 'RESCUE_TEST_POOL');
    await setValue(poolLabel, 'Rescue Operations synthetic test pool');
    await setValue(credentialRequirements, 'Rope Rescue Technician\nDriver Operator');
    await setValue(specialtyRequirements, 'SYNTHETIC_RESCUE');
    await setValue(rankingReference, 'synthetic-rescue-priority-v2');
    await setValue(reason, 'Run the controlled fixture.');
    await submit(beginForm);

    const beginCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    if (!beginCall) throw new Error('Synthetic begin request was not sent.');
    const body = JSON.parse(String(beginCall[1]?.body));
    const headers = new Headers(beginCall[1]?.headers);
    expect(body.policy).toMatchObject({
      source: 'synthetic',
      policy_reference: expect.stringMatching(/^synthetic-/),
      test_policy: {
        policy_label: 'TEST POLICY — NOT APPROVED MBFD POLICY',
        policy_version: 'synthetic-specialty-v2',
        specialty_pool: {
          id: 'RESCUE_TEST_POOL',
          label: 'Rescue Operations synthetic test pool',
        },
        qualification_requirements: {
          v: 1,
          credential_names: ['Rope Rescue Technician', 'Driver Operator'],
          specialty_codes: ['SYNTHETIC_RESCUE'],
        },
        ranking: {
          source: 'EXPLICIT_TEST_PRIORITY',
          reference: 'synthetic-rescue-priority-v2',
        },
        scoring: {
          source: 'EXPLICIT_TEST_PRIORITY',
          direction: 'LOWER_SCORE_WINS',
        },
        tie_break_chain: ['rsc_seniority', 'rank_seniority', 'member_id'],
        normal_bid_interruption: 'SUSPEND_EXACT_NORMAL_TURN',
        candidate_outcomes: [
          'award',
          'declined',
          'unreachable',
          'withdrawn',
          'ineligible_on_recheck',
        ],
        original_bidder_resume: 'RESUME_EXACT_ORIGINAL_TURN',
      },
      candidates: [
        { member_id: 11, explicit_priority: 1 },
        { member_id: 17, explicit_priority: 1 },
      ],
    });
    expect(body.reason).toBe('Run the controlled fixture.');
    expect(body.expected_normal_control_revision).toBe(7);
    expect(headers.get('Idempotency-Key')).toBe(body.command_id);
    expect(container.textContent).toContain('Synthetic command receipt');
    expect(container.textContent).toContain('synthetic_specialty_test');
  });

  it('invalidates stale specialty UI from the live signal and rehydrates through the guarded read', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    let statusReads = 0;
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        const url = String(input);
        if (url === '/api/auth/ws-ticket') {
          return new Response(JSON.stringify({ ticket: 'opaque-specialty-ticket' }), {
            status: 200,
          });
        }
        if (url.endsWith('/specialty-adjudication')) {
          statusReads += 1;
          return new Response(
            JSON.stringify({
              mode: 'synthetic_test_only',
              does_not_commit_bid: true,
              database_audit_log: 'not_written',
              state:
                statusReads === 1 ? initialState() : activeState(3, 'awaiting_original_bidder'),
              normal_turn: normalTurn(),
              audit_receipts: [],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const container = renderWorkspace({ wsBase: 'https://api.staging.bid.mbfdhub.com' });
    const sessionId = container.querySelector<HTMLInputElement>('input[name="session_id"]');
    const inspectForm = container.querySelector<HTMLFormElement>(
      '[data-testid="specialty-inspect-form"]',
    );
    if (!sessionId || !inspectForm) throw new Error('Inspection controls did not render.');
    await setValue(sessionId, 'mock-session-live-1');
    await submit(inspectForm);
    await settle();

    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error('The configured specialty Worker socket was not created.');
    await act(async () => {
      socket.open();
    });
    expect(socket.sent).toEqual([JSON.stringify({ type: 'hello', lastSeq: 0 })]);

    await act(async () => {
      socket.onmessage?.({
        data: JSON.stringify(specialtySignal('mock-session-live-1', 3)),
      } as MessageEvent);
    });
    await settle();

    expect(statusReads).toBe(2);
    expect(
      container.querySelector('[data-testid="specialty-live-control-state"]')?.textContent,
    ).toContain('transport open');
    expect(container.textContent).toContain('Live synthetic specialty state rehydrated');
    expect(container.textContent).toContain('Revision 3');
    expect(container.querySelector('[data-testid="specialty-original-form"]')).not.toBeNull();
  });

  it('offers candidate, original, and resume actions only as the Worker state allows them', async () => {
    let postCount = 0;
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        const url = String(input);
        if (init?.method !== 'POST') {
          return new Response(
            JSON.stringify({
              mode: 'synthetic_test_only',
              does_not_commit_bid: true,
              database_audit_log: 'not_written',
              state: activeState(1, 'resolving_higher_priority_candidates'),
              normal_turn: normalTurn(),
              audit_receipts: [],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        postCount += 1;
        const states = [
          activeState(2, 'awaiting_original_bidder'),
          activeState(3, 'awaiting_resume'),
          { ...initialState(), revision: 4, resumedRequestIds: ['specialty-request-1'] },
        ];
        const operation = url.endsWith('/candidates')
          ? 'resolve_candidate'
          : url.endsWith('/original-request')
            ? 'resolve_original'
            : 'resume';
        return new Response(
          JSON.stringify(accepted(states[postCount - 1], operation, 'Advance fixture.')),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const container = renderWorkspace();
    const sessionId = container.querySelector<HTMLInputElement>('input[name="session_id"]');
    const inspectForm = container.querySelector<HTMLFormElement>(
      '[data-testid="specialty-inspect-form"]',
    );
    if (!sessionId || !inspectForm) throw new Error('Inspection controls did not render.');
    await setValue(sessionId, 'mock-session-1');
    await submit(inspectForm);

    const candidateForm = container.querySelector<HTMLFormElement>(
      '[data-testid="specialty-candidate-form"]',
    );
    const candidateReason = container.querySelector<HTMLTextAreaElement>(
      'textarea[name="candidate_reason"]',
    );
    if (!candidateForm || !candidateReason) throw new Error('Candidate action did not render.');
    await setValue(candidateReason, 'Advance fixture.');
    await submit(candidateForm);
    expect(container.querySelector('[data-testid="specialty-original-form"]')).not.toBeNull();

    const originalForm = container.querySelector<HTMLFormElement>(
      '[data-testid="specialty-original-form"]',
    );
    const originalReason = container.querySelector<HTMLTextAreaElement>(
      'textarea[name="original_reason"]',
    );
    const awardReference = container.querySelector<HTMLInputElement>(
      'input[name="original_award_reference"]',
    );
    if (!originalForm || !originalReason || !awardReference)
      throw new Error('Original action did not render.');
    await setValue(originalReason, 'Advance fixture.');
    await setValue(awardReference, 'synthetic-award-17');
    await submit(originalForm);
    expect(container.querySelector('[data-testid="specialty-resume-form"]')).not.toBeNull();

    const resumeForm = container.querySelector<HTMLFormElement>(
      '[data-testid="specialty-resume-form"]',
    );
    const resumeReason = container.querySelector<HTMLTextAreaElement>(
      'textarea[name="resume_reason"]',
    );
    if (!resumeForm || !resumeReason) throw new Error('Resume action did not render.');
    await setValue(resumeReason, 'Advance fixture.');
    await submit(resumeForm);

    const postUrls = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([input]) => String(input));
    expect(postUrls).toEqual([
      '/api/admin/bid-session/mock-session-1/specialty-adjudication/candidates',
      '/api/admin/bid-session/mock-session-1/specialty-adjudication/original-request',
      '/api/admin/bid-session/mock-session-1/specialty-adjudication/resume',
    ]);
    expect(container.textContent).toContain('Normal Bid turn resumed in synthetic state');
  });
});
