import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BidRoster } from '../../app/admin/bid/_components/BidRoster';

const MEMBERS = {
  '1': { id: 1, firstName: 'Jesus', lastName: 'Sola', rank: 'CPT', employeeId: '14335' },
  '2': { id: 2, firstName: 'John', lastName: 'Smith', rank: 'LT', employeeId: '20001' },
  '3': { id: 3, firstName: 'Jane', lastName: 'Doe', rank: 'FF', employeeId: '20002' },
};

const ORDER = [
  { ordinal: 1, memberId: 1, pool: 'OFC' as const },
  { ordinal: 2, memberId: 2, pool: 'OFC' as const },
  { ordinal: 3, memberId: 3, pool: 'FF' as const },
];

const SNAPSHOT_POSITIONS = [
  {
    id: 'A101',
    templateVersion: 'snapshot-r1',
    bidParticipation: 'BIDDABLE' as const,
    isExcludedFromCount: false,
    shift: 'A' as const,
    station: 'Snapshot Station',
    unit: 'Immutable Unit',
    rankRequired: 'FF',
    positionName: 'Immutable Position',
  },
];

describe('BidRoster SSR', () => {
  it('renders rows for every bidder with rank and name', () => {
    const html = renderToString(
      <BidRoster
        bidOrder={ORDER}
        members={MEMBERS}
        currentBidderId={null}
        fills={{}}
        preview={false}
      />,
    );
    expect(html).toContain('data-testid="bid-roster-row-1"');
    expect(html).toContain('data-testid="bid-roster-row-2"');
    expect(html).toContain('data-testid="bid-roster-row-3"');
    expect(html).toContain('Sola');
    expect(html).toContain('Smith');
    expect(html).toContain('Doe');
  });

  it('badges the current bidder as "Up now"', () => {
    const html = renderToString(
      <BidRoster
        bidOrder={ORDER}
        members={MEMBERS}
        currentBidderId={2}
        fills={{}}
        preview={false}
      />,
    );
    expect(html).toMatch(/data-testid="bid-roster-row-2"[^>]*data-status="current"/);
    expect(html).toContain('Up now');
  });

  it('marks filled members as picked', () => {
    const html = renderToString(
      <BidRoster
        bidOrder={ORDER}
        members={MEMBERS}
        currentBidderId={null}
        fills={{ A101: { memberId: 1, ordinal: 1, bidId: 'b1' } }}
        preview={false}
      />,
    );
    expect(html).toMatch(/data-testid="bid-roster-row-1"[^>]*data-status="picked"/);
    expect(html).toMatch(/data-testid="bid-roster-row-2"[^>]*data-status="waiting"/);
  });

  it('shows the preview badge when the worker computed bidOrder on-the-fly', () => {
    const html = renderToString(
      <BidRoster bidOrder={ORDER} members={MEMBERS} currentBidderId={null} fills={{}} preview />,
    );
    expect(html).toContain('data-testid="bid-roster-preview-badge"');
    expect(html).toContain('preview — session not started');
  });

  it('falls back to memberId when the members map is missing the row', () => {
    const html = renderToString(
      <BidRoster bidOrder={ORDER} members={{}} currentBidderId={null} fills={{}} preview={false} />,
    );
    // React inserts comment markers between literal text and interpolated
    // values, so the rendered DOM is "#<!-- -->1" — match the surrounding
    // testid + value combination instead of the exact glyph.
    expect(html).toMatch(/data-testid="bid-roster-row-1"[\s\S]*?>1</);
    expect(html).toMatch(/data-testid="bid-roster-row-2"[\s\S]*?>2</);
  });

  it('uses the immutable session position material for picked-position labels', () => {
    const html = renderToString(
      <BidRoster
        bidOrder={ORDER}
        members={MEMBERS}
        currentBidderId={null}
        fills={{ A101: { memberId: 1, ordinal: 1, bidId: 'b1' } }}
        preview={false}
        snapshotBound
        positions={SNAPSHOT_POSITIONS}
      />,
    );

    expect(html).toContain('Immutable Unit');
    expect(html).toContain('Immutable Position');
    expect(html).not.toContain('Ladder 1');
  });

  it('does not infer a static position label for a snapshot-bound roster without material', () => {
    const html = renderToString(
      <BidRoster
        bidOrder={ORDER}
        members={MEMBERS}
        currentBidderId={null}
        fills={{ A101: { memberId: 1, ordinal: 1, bidId: 'b1' } }}
        preview={false}
        snapshotBound
      />,
    );

    expect(html).toContain('A101');
    expect(html).not.toContain('Ladder 1');
  });
});
