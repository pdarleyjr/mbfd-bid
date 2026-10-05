// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Presentation, PresentationView } from '../../app/live/PresentationView';
import {
  type PresentationADay,
  presentationADayStations,
  presentationBoardPages,
} from '../../app/live/presentation-layout';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root;
let host: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;

function projection(): PresentationADay {
  return {
    availability: 'AVAILABLE',
    sequence: 10,
    groups: [
      {
        shift: 'A',
        value: 'G1',
        used: 2,
        maximum: null,
        remaining: null,
        saved_override: false,
        capacities: [
          {
            id: 'officers',
            label: 'Officers',
            pool: 'OFC',
            used: 1,
            maximum: null,
            remaining: null,
          },
          { id: 'ff', label: 'Firefighters', pool: 'FF', used: 1, maximum: null, remaining: null },
          { id: 'marine', label: 'Marine', pool: 'FF', used: 1, maximum: 4, remaining: 3 },
        ],
        members: [
          { member_id: 1, name: 'Saved Captain', rank: 'CPT', position_id: 'A101', forced: false },
          {
            member_id: 2,
            name: 'Saved Firefighter',
            rank: 'FF',
            position_id: 'A102',
            forced: true,
          },
        ],
      },
      {
        shift: 'A',
        value: 'G4',
        used: 1,
        maximum: null,
        remaining: null,
        saved_override: true,
        capacities: [],
        members: [
          { member_id: 4, name: 'Saved Override', rank: 'LT', position_id: 'A104', forced: false },
        ],
      },
      {
        shift: 'B',
        value: 'G2',
        used: 1,
        maximum: 5,
        remaining: 4,
        saved_override: false,
        capacities: [],
        members: [
          { member_id: 5, name: 'B Shift Member', rank: 'FF', position_id: 'B101', forced: false },
        ],
      },
    ],
    pending: [
      { member_id: 3, name: 'Pending Member', rank: 'FF', shift: 'A', position_id: 'A103' },
    ],
  };
}

function view(isMock = false): Presentation {
  return {
    mode: 'LIVE',
    sequence: 10,
    session: { id: 'synthetic-a-day', bid_year: 2026, is_mock: isMock },
    current_bidder: { member_id: 6, name: 'Current Bidder', rank: 'FF' },
    on_deck: [{ member_id: 7, name: 'Next Bidder', rank: 'FF' }],
    progress: { filled: 5, total: 223 },
    a_day: projection(),
    positions: [
      {
        id: 'A101',
        shift: 'A',
        station: '1',
        unit: 'Combat 1',
        position_name: 'Captain',
        rank_required: 'CPT',
        filled_by: null,
      },
    ],
  };
}

async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (node) => node.textContent === label || node.getAttribute('aria-label') === label,
  );
  if (!button) throw new Error(`Missing button ${label}`);
  await act(() => button.click());
}

beforeEach(() => {
  vi.useFakeTimers();
  fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('presentation A-Day view', () => {
  it.each([false, true])(
    'shows canonical capacities, saved groups and separate pending selections without new requests (Mock %s)',
    async (isMock) => {
      await act(() => root.render(<PresentationView initial={view(isMock)} />));
      expect(host.querySelector('[data-testid="presentation-station-board"]')).not.toBeNull();
      await click('A-Days');
      const board = host.querySelector('[data-testid="presentation-a-day-board"]');
      expect(board?.textContent).toContain('Saved Captain');
      expect(board?.textContent).toContain('Saved Firefighter');
      expect(board?.textContent).toContain('A101');
      expect(board?.textContent).not.toContain('a-day:');
      expect(board?.textContent).toContain('Saved override');
      expect(board?.textContent).toContain('Pending A-Day');
      expect(board?.textContent).toContain('Pending Member');
      expect(board?.textContent).toContain('2 taken · Limit not set');
      expect(host.querySelector('[data-capacity-id="marine"]')?.textContent).toContain(
        '1 taken3 available',
      );
      expect(host.querySelector('[data-capacity-id="officers"]')?.textContent).toContain(
        'Limit not set',
      );
      expect(host.querySelectorAll('[data-testid="presentation-a-day-member"]')).toHaveLength(4);
      expect(board?.querySelectorAll('[role="img"][aria-label="Forced assignment"]')).toHaveLength(
        1,
      );
      expect(board?.querySelector('button,a,input')).toBeNull();
      expect(
        host.querySelector('[data-testid="presentation-current-bidder"]')?.textContent,
      ).toContain('Current Bidder');
      expect(host.querySelector('[data-testid="presentation-on-deck"]')?.textContent).toContain(
        'Next Bidder',
      );
      expect(host.textContent).toContain('5 / 223 taken');
      expect(host.textContent).toContain('2 groups · 1 pending');
      expect(fetcher).not.toHaveBeenCalled();
      await click('Next shift');
      expect(board?.textContent).toContain('B Shift Member');
      expect(board?.textContent).not.toContain('Saved Captain');
      expect(board?.textContent).toContain('1 taken · 4 available');
      await click('Show Days');
      expect(board?.textContent).toContain('No A-Day groups configured for this shift.');
      expect(board?.textContent).not.toMatch(/MON|Monday|TUE|Tuesday/);
      await click('Positions');
      expect(host.querySelector('[data-testid="presentation-a-day-board"]')).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('keeps the chosen view while existing refresh replaces canonical A-Day data and rejects a mixed sequence', async () => {
    const initial = view();
    await act(() =>
      root.render(<PresentationView initial={initial} sessionId="synthetic-a-day" />),
    );
    await click('A-Days');
    const fresh = view();
    fresh.sequence = 11;
    if (!fresh.a_day) throw new Error('A-Day fixture missing');
    fresh.a_day.sequence = 11;
    if (!fresh.a_day.groups[0]?.members[0]) throw new Error('Member fixture missing');
    fresh.a_day.groups[0].members[0].name = 'New Saved Name';
    fetcher.mockResolvedValueOnce(Response.json(fresh));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/presentation?bidSessionId=synthetic-a-day');
    expect(host.querySelector('[data-testid="presentation-a-day-board"]')?.textContent).toContain(
      'New Saved Name',
    );
    fresh.sequence = 12;
    fetcher.mockResolvedValueOnce(Response.json(fresh));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(host.querySelector('[data-testid="presentation-a-day-board"]')?.textContent).toContain(
      'A-Day groups are updating.',
    );
    expect(host.textContent).not.toContain('New Saved Name');
  });

  it('accepts the held A-Day checkpoint and hides live A-Day data mixed into a held display', async () => {
    const held = { ...view(), mode: 'HOLD' as const, sequence: 20, held_at_sequence: 10 };
    await act(() => root.render(<PresentationView initial={held} />));
    await click('A-Days');
    expect(host.textContent).toContain('Saved Captain');
    if (!held.a_day) throw new Error('A-Day fixture missing');
    held.a_day.sequence = 20;
    await act(() => root.render(<PresentationView initial={held} key="mixed-held" />));
    await click('A-Days');
    expect(host.textContent).toContain('A-Day groups are updating.');
    expect(host.textContent).not.toContain('Saved Captain');
  });

  it('shows unavailable legacy evidence without inferring capacities or assignments from current staffing', async () => {
    const initial = view();
    initial.a_day = {
      availability: 'UNAVAILABLE',
      sequence: 10,
      groups: [],
      pending: [],
      code: 'UNKNOWN',
    };
    await act(() => root.render(<PresentationView initial={initial} />));
    await click('A-Days');
    expect(host.textContent).toContain('A-Day groups could not be checked.');
    expect(host.querySelectorAll('[data-testid="presentation-a-day-member"]')).toHaveLength(0);
  });
});

describe('A-Day frame pagination', () => {
  it.each([
    [320, 230],
    [640, 180],
    [1280, 660],
    [3500, 1850],
  ])('preserves all allocations and pending names once in a %s by %s frame', (width, height) => {
    const data = projection();
    const template = data.groups[0];
    if (!template) throw new Error('Group fixture missing');
    data.groups = [1, 2, 3, 4].map((group) => ({
      ...template,
      value: `G${group}`,
      members: Array.from({ length: 18 }, (_, index) => ({
        member_id: group * 100 + index,
        name: `Complete member name ${group} ${index}`,
        rank: 'FF',
        position_id: `A${group * 100 + index}`,
        forced: false,
      })),
      used: 18,
    }));
    const before = JSON.stringify(data);
    const stations = presentationADayStations(data, 'A', []);
    const pages = presentationBoardPages(stations, width, height, {}, 60);
    const members = pages.pages
      .flat()
      .flatMap((part) => part.seats)
      .filter((row) => row.filled_by);
    expect(members).toHaveLength(73);
    expect(new Set(members.map((row) => row.id)).size).toBe(73);
    expect(members.some((row) => row.filled_by?.name === 'Pending Member')).toBe(true);
    expect(JSON.stringify(data)).toBe(before);
    for (const page of pages.pages)
      for (const part of page) {
        const minimumHeight = width < 760 ? 64 : width >= 2400 ? 48 : 36;
        expect(part.seats.length * minimumHeight + 60).toBeLessThanOrEqual(height);
      }
  });

  it('preserves an empty configured group header without inventing members or available slots', () => {
    const data = projection();
    data.groups = [
      {
        shift: 'A',
        value: 'G2',
        used: 0,
        maximum: null,
        remaining: null,
        saved_override: false,
        capacities: [],
        members: [],
      },
    ];
    data.pending = [];
    const stations = presentationADayStations(data, 'A', []);
    expect(presentationBoardPages(stations, 320, 230, {}, 60).pages[0]?.[0]).toMatchObject({
      label: 'Group 2',
      seats: [],
      total: 0,
    });
  });
});
