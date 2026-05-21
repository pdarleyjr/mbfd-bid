import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StationGroupedGrid } from '../../app/_components/bid/StationGroupedGrid';

const MEMBERS = {
  '1': { id: 1, firstName: 'Jesus', lastName: 'Sola', rank: 'CPT', employeeId: '14335' },
};

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
});
