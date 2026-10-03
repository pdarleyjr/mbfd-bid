import { describe, expect, it } from 'vitest';
import {
  type PresentationPosition,
  presentationBoardPages,
  presentationQueue,
  presentationStations,
} from '../../app/live/presentation-layout';

const seats: PresentationPosition[] = Array.from({ length: 74 }, (_, index) => ({
  id: `A${index + 101}`,
  shift: 'A',
  station:
    index < 21 ? '1' : index < 38 ? '2' : index < 56 ? '3' : index < 69 ? '4' : 'Rescue Float',
  unit: 'Engine',
  position_name: 'Firefighter',
  rank_required: 'FF',
  filled_by: index === 0 ? { member_id: 100, name: 'Assigned Member', rank: 'FF' } : null,
}));

describe('presentation frame pagination', () => {
  it.each([
    [320, 230],
    [640, 180],
    [1280, 660],
    [1620, 850],
    [3500, 1850],
  ])('preserves all 74 seats exactly once in a %s by %s frame', (width, height) => {
    const { pages } = presentationBoardPages(presentationStations(seats, 'A'), width, height);
    const displayed = pages.flat().flatMap((station) => station.seats);
    expect(displayed.map((seat) => seat.id).sort()).toEqual(seats.map((seat) => seat.id).sort());
    expect(displayed.filter((seat) => seat.filled_by?.name === 'Assigned Member')).toHaveLength(1);
    expect(new Set(displayed.map((seat) => seat.id)).size).toBe(74);
    if (width <= 640) expect(pages.length).toBeGreaterThan(1);
    if (width >= 1620) expect(pages).toHaveLength(1);
  });

  it('keeps Days and chief-directed roles distinct from biddable seats', () => {
    const firstSeat = seats[0];
    if (!firstSeat) throw new Error('The station fixture requires a seat');
    const stations = presentationStations(
      [...seats, { ...firstSeat, id: 'D101', shift: 'D', station: 'Prevention' }],
      'D',
      [
        {
          member_id: 200,
          name: 'Chief-directed Captain',
          rank: 'CPT',
          role_label: 'Division Chief of Prevention',
          forced: true,
        },
      ],
    );
    expect(stations).toHaveLength(2);
    expect(stations[0]?.seats[0]?.id).toBe('D101');
    expect(stations[1]?.label).toBe('Chief assignments');
    expect(stations[1]?.seats[0]?.chief_directed).toBe(true);
    expect(stations[1]?.seats[0]?.position_name).toBe('Division Chief of Prevention');
    expect(stations[1]?.seats[0]?.filled_by?.name).toBe('Chief-directed Captain');
  });

  it('repaginates wrapped names using their measured row height', () => {
    const station = presentationStations(seats.slice(0, 3), 'A');
    const { pages } = presentationBoardPages(station, 1024, 186, { A101: 84, A102: 84 });
    expect(pages.map((page) => page.flatMap((part) => part.seats.map((seat) => seat.id)))).toEqual([
      ['A101'],
      ['A102', 'A103'],
    ]);
  });

  it('uses the authoritative remaining queue and retains an awarded member awaiting A-Day', () => {
    const current = { member_id: 1, name: 'Current Member', rank: 'CPT' };
    const awaiting = { member_id: 2, name: 'Specialty Member', rank: 'CPT', pending_a_day: true };
    const members = presentationQueue([current, awaiting, current, null], current, [
      { member_id: 3, name: 'Completed Member', rank: 'CPT' },
    ]);
    expect(members.map((member) => member.member_id)).toEqual([1, 2]);
    expect(members[1]?.pending_a_day).toBe(true);
  });
});
