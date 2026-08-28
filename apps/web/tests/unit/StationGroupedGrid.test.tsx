import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StationGroupedGrid } from '../../app/_components/bid/StationGroupedGrid';

const MEMBERS = {
  '1': { id: 1, firstName: 'Jesus', lastName: 'Sola', rank: 'CPT', employeeId: '14335' },
};

const SNAPSHOT_POSITIONS = [
  {
    id: 'A901',
    templateVersion: 'snapshot-r1',
    bidParticipation: 'BIDDABLE' as const,
    isExcludedFromCount: false,
    shift: 'A' as const,
    station: 'Snapshot Station',
    unit: 'Snapshot Unit',
    rankRequired: 'FF',
    positionName: 'Immutable Position',
  },
];

describe('StationGroupedGrid SSR snapshot', () => {
  it('renders the four combat station columns for shift A', () => {
    const html = renderToString(<StationGroupedGrid members={MEMBERS} defaultShift="A" />);
    expect(html).toContain('Station #1');
    expect(html).toContain('Station #2');
    expect(html).toContain('Station #3');
    expect(html).toContain('Station #4');
    expect(html).toContain('Rescue Float Pool');
  });

  it('renders A101 with its unit + role line', () => {
    const html = renderToString(<StationGroupedGrid members={MEMBERS} defaultShift="A" />);
    expect(html).toContain('A101');
    expect(html).toContain('Ladder 1');
    expect(html).toContain('Captain');
    expect(html).toContain('Open'); // unfilled by default
  });

  it('switches initial render set when defaultShift changes', () => {
    const a = renderToString(<StationGroupedGrid members={MEMBERS} defaultShift="A" />);
    const b = renderToString(<StationGroupedGrid members={MEMBERS} defaultShift="B" />);
    expect(a).toContain('A101');
    expect(a).not.toContain('B101');
    expect(b).toContain('B101');
    expect(b).not.toContain('A101');
  });

  it('omits stations that have zero positions in the selected shift', () => {
    const html = renderToString(<StationGroupedGrid members={MEMBERS} defaultShift="A" />);
    // Days only exists in D-shift; the A-shift render must not include a
    // "Days" station header (other tokens like "Sunday" might appear in
    // unit names, hence the strict header match).
    expect(html).not.toMatch(/>Days</);
  });

  it('renders shift tabs with all four shifts', () => {
    const html = renderToString(<StationGroupedGrid members={MEMBERS} defaultShift="A" />);
    expect(html).toContain('shift-tab-A');
    expect(html).toContain('shift-tab-B');
    expect(html).toContain('shift-tab-C');
    expect(html).toContain('shift-tab-D');
  });

  it('groups positions by apparatus (unit) within each station', () => {
    const html = renderToString(<StationGroupedGrid members={MEMBERS} defaultShift="A" />);
    // Each apparatus gets its own subheader so bidders can spot which
    // vehicle a position belongs to without reading the cell.
    expect(html).toContain('data-testid="apparatus-ladder-1"');
    expect(html).toContain('data-testid="apparatus-engine-1"');
    expect(html).toContain('data-testid="apparatus-rescue-1"');
    expect(html).toContain('data-testid="apparatus-float-1"');
  });

  it('uses immutable session positions instead of the bundled position catalog', () => {
    const html = renderToString(
      <StationGroupedGrid
        members={MEMBERS}
        defaultShift="A"
        snapshotBound
        positions={SNAPSHOT_POSITIONS}
      />,
    );

    expect(html).toContain('A901');
    expect(html).toContain('Snapshot Station');
    expect(html).toContain('Immutable Position');
    expect(html).not.toContain('A101');
  });

  it('does not infer the bundled catalog when a session lacks immutable positions', () => {
    const html = renderToString(
      <StationGroupedGrid members={MEMBERS} defaultShift="A" snapshotBound />,
    );

    expect(html).toContain('data-testid="immutable-positions-unavailable"');
    expect(html).not.toContain('A101');
  });
});
