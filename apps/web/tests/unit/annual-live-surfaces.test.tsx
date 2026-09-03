import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnnualLiveControls } from '../../app/admin/bid/_components/AnnualLiveControls';
import { type Presentation, PresentationView } from '../../app/live/PresentationView';

describe('annual live product surfaces', () => {
  it('renders a completely read-only member presentation with safe progress', () => {
    const initial: Presentation = {
      mode: 'HOLD',
      held_at_sequence: 12,
      session: { id: 's1', bid_year: 2027 },
      current_stage: { id: 'ff', label: 'ABC Firefighter' },
      current_bidder: { member_id: 1, name: 'Alex Member', rank: 'FF' },
      on_deck: [{ member_id: 2, name: 'Jordan Member', rank: 'FF' }],
      phase: 'position_bid',
      progress: { filled: 1, total: 2 },
      positions: [
        {
          id: 'A101',
          shift: 'A',
          station: '1',
          unit: 'Engine 1',
          position_name: 'Firefighter',
          rank_required: 'FF',
          filled_by: { member_id: 3, name: 'Taylor Member', rank: 'FF' },
        },
      ],
      specialty: {
        active: true,
        label: 'Marine',
        position_id: 'A101',
        status: 'PRIORITY REVIEW IN PROGRESS',
      },
    };
    const html = renderToString(<PresentationView initial={initial} />);
    expect(html).toContain('DISPLAY HELD');
    expect(html).toContain('ABC Firefighter');
    expect(html).toContain('Station and apparatus board');
    expect(html).toContain('PRIORITY REVIEW IN PROGRESS');
    expect(html).not.toContain('credential');
    expect(html).not.toContain('<button');
  });

  it('keeps real operator mutations on the canonical live command surface', () => {
    const html = renderToString(
      <AnnualLiveControls
        bidSessionId="s1"
        isMock={false}
        currentBidderId={1}
        bidOrder={[{ memberId: 1 }, { memberId: 2 }]}
        fills={{}}
        members={{}}
        positions={[]}
      />,
    );
    expect(html).toContain('HOLD DISPLAY');
    expect(html).toContain('RESUME DISPLAY');
    expect(html).toContain('Start specialty review');
    expect(html).toContain('Amend latest committed selection');
    expect(html).toContain('Alter remaining order');
    expect(html).toContain('Record current bidder selection');
  });

  it('exposes the canonical controls in an isolated mock rehearsal', () => {
    const html = renderToString(
      <AnnualLiveControls
        bidSessionId="mock-s1"
        isMock={true}
        currentBidderId={1}
        bidOrder={[{ memberId: 1 }, { memberId: 2 }]}
        fills={{}}
        members={{}}
        positions={[]}
      />,
    );
    expect(html).toContain('data-testid="annual-live-controls"');
    expect(html).toContain('MOCK REHEARSAL');
    expect(html).toContain('canonical commands remain isolated');
    expect(html).toContain('HOLD DISPLAY');
    expect(html).toContain('Start specialty review');
    expect(html).toContain('Record current bidder selection');
  });
});
