// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberBidFormResponse } from '../../../worker/src/lib/bid-form-source';
import type { MemberLite } from '../../app/_components/bid/types';
import { BidMemberPanel } from '../../app/admin/bid/_components/BidMemberPanel';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const member: MemberLite = {
  id: 17,
  firstName: 'Test',
  lastName: 'Member',
  employeeId: 'E17',
  rank: 'CPT',
  historicalContext: {
    year: 2025,
    evidenceStatus: 'RECORDED',
    historicalPositionId: 'A109',
    positionLabel: 'Rescue Lieutenant',
    shift: 'A',
    station: 'Station 1',
    unit: 'Rescue 1',
    aDayGroup: 'GR4',
    sourceName: 'Historical source',
    sourceSha256: null,
    sourceLocation: 'A shift row 9',
    archiveSha256: null,
  },
};
function formResponse(
  id = 17,
  status: MemberBidFormResponse['status'] = 'SUBMITTED',
): MemberBidFormResponse {
  return {
    year: 2026,
    memberId: id,
    sessionId: 'saved-synthetic',
    status,
    source: { name: '2026BidForms.xlsx', sha256: 'a'.repeat(64) },
    sourceLocation: { sheet: 'Forms', row: 8 },
    archiveSha256: 'b'.repeat(64),
    publishedAt: '2026-10-04T14:00:00Z',
    form:
      status === 'SUBMITTED'
        ? {
            employeeId: 'wrong-original',
            sourceName: 'Member, Test',
            sourceRank: 'Captain',
            attendingTeams: 'Yes',
            phone1: '555-0100',
            phone2: null,
            positionPreferences: [
              { order: 1, shift: 'C Shift', unit: 'Rescue 3' },
              { order: 2, shift: 'A Shift', unit: 'Combat Float' },
            ],
            aDayPreferences: [
              { order: 1, sourceLabel: 'C3', shift: 'C', group: 'G3' },
              { order: 2, sourceLabel: 'Original undecoded choice', shift: null, group: null },
            ],
            sourceLocation: { sheet: 'Forms', row: 8 },
            identityResolution: {
              employeeId: 'E17',
              method: 'AUTHORITATIVE_DIRECTORY_CORRECTION',
              source: { name: 'Directory.xlsx', sha256: 'c'.repeat(64) },
              sourceLocation: 'row 10',
              discrepancy: 'Original form ID differs from the reviewed directory.',
            },
          }
        : null,
    airTechReference: {
      employeeId: 'E17',
      sourceMemberName: 'Member, Test',
      bidOrder: 9,
      driverEngineerPoints: 2,
      airTechPoints: 3,
      carSeatPoints: 0,
      dronePoints: 1,
      operationsPoints: 0,
      technicianPoints: 0,
      totalPoints: 6,
      rankSeniority: 10,
      generatedAt: '10/2/2026 08:43:00',
      sourceName: 'AirTech Summary.pdf',
      sourceSha256: 'd'.repeat(64),
    },
  };
}
function personResponse(id = 17) {
  return {
    asOf: '2026-10-04',
    person: {
      id,
      assignments: [
        {
          id: 'current',
          positionName: 'Current Captain',
          shift: 'B',
          station: 'Station 2',
          unit: 'Engine 2',
        },
      ],
      serviceRecord: { hiredAt: '2000-01-01', rankSeniority: 10 },
    },
    qualifications: {
      certifications: [
        {
          credentialId: 4,
          credentialName: 'Driver Engineer',
          status: 'active',
          effectiveOn: '2020-01-01',
          expiresOn: null,
        },
        {
          credentialId: 8,
          credentialName: 'AirTech',
          status: 'expired',
          effectiveOn: '2020-01-01',
          expiresOn: '2026-09-01',
        },
      ],
      specialties: [],
    },
  };
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
let root: Root;
let container: HTMLDivElement;
let requests: Array<{ url: string; init?: RequestInit | undefined }>;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  requests = [];
  fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes('/department/people/')) return response(personResponse());
    if (url.includes('/bid-forms/')) return response(formResponse());
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function render(selected = member, sessionId = 'saved-synthetic') {
  await settle(() =>
    root.render(
      <BidMemberPanel
        member={selected}
        upNow
        compact
        recordedSeats={['A401']}
        sessionId={sessionId}
        bidYear={2026}
      />,
    ),
  );
}
function namedButton(name: string) {
  const button = [...document.querySelectorAll('button')].find(
    (node) => node.getAttribute('aria-label') === name || node.textContent === name,
  );
  if (!button) throw new Error(`Missing button ${name}`);
  return button;
}
async function open() {
  await settle(() => {
    const trigger = namedButton('View Capt Test Member details');
    trigger.focus();
    trigger.click();
  });
}
async function tab(name: string) {
  await settle(() => namedButton(name).click());
}
function panel() {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) throw new Error('Missing member dialog');
  return dialog;
}
describe('member information focused workspace', () => {
  it('shows previous and current context inline, then read-only credentials and submitted choices in a focused panel', async () => {
    await render();
    expect(container.textContent).toContain('Rescue Lieutenant');
    expect(container.textContent).toContain('A-Day Group 4');
    expect(container.textContent).toContain('Current Captain');
    expect(requests.some(({ url }) => url.includes('/bid-forms/'))).toBe(false);
    await open();
    expect(panel().textContent).toContain('Hire date');
    expect(panel().textContent).toContain('2025 bid / assignment');
    const formRequest = requests.find(({ url }) => url.includes('/bid-forms/'));
    expect(formRequest?.url).toBe(
      '/api/admin/bid-forms/2026/members/17?session_id=saved-synthetic',
    );
    expect(formRequest?.init?.cache).toBe('no-store');
    await tab('Credentials');
    expect(panel().textContent).toContain('Driver Engineer');
    expect(panel().textContent).toContain('active');
    expect(panel().textContent).toContain('AirTech');
    expect(panel().textContent).toContain('expired');
    expect(panel().textContent).toContain('Expires 2026-09-01');
    expect(panel().textContent).toContain('Bid eligibility uses this session’s saved evidence.');
    expect(panel().querySelector('details')?.open).toBe(false);
    await tab('Bid form');
    expect(panel().textContent).toContain('C Shift · Rescue 3');
    expect(panel().textContent).toContain('C shift · Group 3');
    expect(panel().textContent).toContain('Original undecoded choice');
    expect(panel().textContent).toContain('Form ID wrong-original · matched employee E17');
    expect([...panel().querySelectorAll('details')].every((details) => !details.open)).toBe(true);
    expect(requests.every(({ init }) => !init?.method || init.method === 'GET')).toBe(true);
  });
  it.each(['NOT_SUBMITTED', 'NOT_LISTED', 'IDENTITY_REVIEW', 'SOURCE_UNAVAILABLE'] as const)(
    'explains %s without inventing member preferences',
    async (status) => {
      fetcher.mockImplementation(async (input: RequestInfo | URL) =>
        response(
          String(input).includes('/bid-forms/') ? formResponse(17, status) : personResponse(),
        ),
      );
      await render();
      await open();
      await tab('Bid form');
      const messages = {
        NOT_SUBMITTED: 'listed as not having submitted',
        NOT_LISTED: 'not listed in the supplied',
        IDENTITY_REVIEW: 'needs an identity review',
        SOURCE_UNAVAILABLE: 'have not been published',
      };
      expect(panel().textContent).toContain(messages[status]);
      expect(panel().textContent).not.toContain('C Shift · Rescue 3');
    },
  );
  it('supports error retry without showing another member’s form', async () => {
    let attempts = 0;
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      if (!String(input).includes('/bid-forms/')) return response(personResponse());
      attempts++;
      return response(formResponse(attempts === 1 ? 18 : 17));
    });
    await render();
    await open();
    await tab('Bid form');
    expect(panel().textContent).toContain('did not match this member and bid');
    expect(panel().textContent).not.toContain('C Shift · Rescue 3');
    await settle(() => namedButton('Retry bid information').click());
    expect(panel().textContent).toContain('C Shift · Rescue 3');
    expect(attempts).toBe(2);
  });
  it('keeps fetched tabs manually activated and returns focus when the dialog closes', async () => {
    await render();
    await open();
    const overview = namedButton('Overview');
    await settle(() => {
      overview.focus();
      overview.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe('Credentials');
    expect(overview.getAttribute('aria-selected')).toBe('true');
    await settle(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      ),
    );
    expect(document.activeElement?.textContent).toBe('Bid form');
    expect(overview.getAttribute('aria-selected')).toBe('true');
    await settle(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(overview);
    await settle(() =>
      overview.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(namedButton('View Capt Test Member details'));
  });
  it('can retry both personnel and submitted form load failures without changing a bid', async () => {
    let personnelReads = 0;
    let formReads = 0;
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/bid-forms/'))
        return ++formReads === 1
          ? response({ error: 'unavailable' }, 503)
          : response(formResponse());
      return ++personnelReads <= 2
        ? response({ error: 'unavailable' }, 503)
        : response(personResponse());
    });
    await render();
    await open();
    expect(panel().textContent).toContain('Member details could not be loaded.');
    await settle(() => namedButton('Retry member details').click());
    expect(panel().textContent).toContain('Hire date');
    await tab('Bid form');
    expect(panel().textContent).toContain('Submitted bid information could not be loaded.');
    await settle(() => namedButton('Retry bid information').click());
    expect(panel().textContent).toContain('C Shift · Rescue 3');
    expect(personnelReads).toBe(3);
    expect(formReads).toBe(2);
  });
  it('refreshes current certifications whenever the same member’s panel is reopened after an external update', async () => {
    let currentName = 'Initial certification';
    let reads = 0;
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/bid-forms/')) return response(formResponse());
      reads++;
      const person = personResponse();
      person.qualifications.certifications = person.qualifications.certifications.map(
        (credential, index) =>
          index === 0 ? { ...credential, credentialName: currentName } : credential,
      );
      return response(person);
    });
    await render();
    currentName = 'Reviewed current certification';
    await open();
    await tab('Credentials');
    expect(panel().textContent).toContain('Reviewed current certification');
    expect(panel().textContent).not.toContain('Initial certification');
    await settle(() => namedButton('Close panel').click());
    currentName = 'Later personnel update';
    await open();
    await tab('Credentials');
    expect(panel().textContent).toContain('Later personnel update');
    expect(panel().textContent).not.toContain('Reviewed current certification');
    expect(reads).toBe(3);
  });
  it('rejects stale responses when the selected member changes while information is loading', async () => {
    let release: (response: Response) => void = () => {};
    let oldSignal: AbortSignal | null | undefined;
    fetcher.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/members/17?')) {
        oldSignal = init?.signal;
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      if (String(input).includes('/members/18?'))
        return Promise.resolve(response(formResponse(18, 'NOT_SUBMITTED')));
      return Promise.resolve(response(personResponse(String(input).endsWith('/18') ? 18 : 17)));
    });
    await render();
    await open();
    await tab('Bid form');
    expect(panel().textContent).toContain('Loading submitted bid information');
    await render({ ...member, id: 18, employeeId: 'E18', firstName: 'New' });
    expect(oldSignal?.aborted).toBe(true);
    expect(panel().textContent).toContain('listed as not having submitted');
    await settle(() => release(response(formResponse())));
    expect(panel().textContent).not.toContain('C Shift · Rescue 3');
    expect(panel().textContent).toContain('listed as not having submitted');
  });
});
