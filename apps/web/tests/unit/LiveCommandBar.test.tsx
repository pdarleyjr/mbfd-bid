import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiveCommandBar } from '../../app/admin/bid/_components/LiveCommandBar';

function ssr(node: React.ReactElement): string {
  return renderToString(node);
}

// jsdom-free smoke tests — verify SSR markup carries the operationally
// critical labels and testids. Interactive behaviour (timer ticks, dialog
// open/close) is left to Playwright; these tests guard against the
// "Skip button invisible" / "phase missing" / "controls missing" classes
// of regression the chief flagged in the prior screenshot.

const BASE_PROPS = {
  bidSessionId: 'test-session',
  currentPhase: 'position_bid',
  sessionStartedAt: Date.now() - 60_000,
  turnStartedAtMs: Date.now(),
  turnTimerSeconds: 180,
  currentBidder: null,
  currentBidderId: null,
  onDeck: [],
  isMock: false,
  lastSeq: 7,
};

describe('LiveCommandBar SSR', () => {
  it('renders the three primary action buttons with visible labels', () => {
    const html = ssr(<LiveCommandBar {...BASE_PROPS} />);
    expect(html).toContain('data-testid="admin-action-skip"');
    expect(html).toContain('>Skip<');
    expect(html).toContain('data-testid="admin-action-override"');
    expect(html).toContain('>Override<');
    expect(html).toContain('data-testid="admin-action-freeze"');
    expect(html).toContain('>Freeze<');
    // Explicit text colors so the buttons never fall back to the admin
    // layout's text-slate-50 and disappear against white backgrounds.
    expect(html).toMatch(/admin-action-skip[\s\S]*?text-stone-900/);
  });

  it('renders the phase chip and session/turn timers without AI controls', () => {
    const html = ssr(<LiveCommandBar {...BASE_PROPS} />);
    expect(html).toContain('position_bid');
    expect(html).toContain('data-testid="session-uptime"');
    expect(html).toContain('data-testid="turn-remaining"');
    expect(html).not.toContain('toggle-ai-panel');
    expect(html).not.toContain('AI cost');
    expect(html).not.toContain('Show AI');
    expect(html).not.toContain('Hide AI');
  });

  it('renders only rehearsal-safe controls for a mock session', () => {
    const html = ssr(<LiveCommandBar {...BASE_PROPS} isMock />);

    expect(html).toContain('Mock rehearsal');
    expect(html).toContain('data-testid="mock-freeze-action"');
    expect(html).not.toContain('data-testid="admin-action-skip"');
    expect(html).not.toContain('data-testid="admin-action-override"');
    expect(html).not.toContain('data-testid="admin-action-freeze"');
  });

  it('falls back to em-dash when the session has no start time', () => {
    const html = ssr(
      <LiveCommandBar {...BASE_PROPS} sessionStartedAt={null} turnStartedAtMs={null} />,
    );
    // Both timers should render the placeholder.
    expect(html).toContain('data-testid="session-uptime"');
    expect(html).toMatch(/data-testid="session-uptime"[^>]*>—</);
    expect(html).toMatch(/data-testid="turn-remaining"[^>]*>—</);
  });

  it('renders the on-deck strip only when there are queued bidders', () => {
    const empty = ssr(<LiveCommandBar {...BASE_PROPS} />);
    expect(empty).not.toContain('data-testid="on-deck-strip"');

    const withQueue = ssr(
      <LiveCommandBar
        {...BASE_PROPS}
        onDeck={[
          {
            memberId: 1,
            ordinal: 5,
            pool: 'OFC',
            firstName: 'Jesus',
            lastName: 'Sola',
            rank: 'CPT',
            employeeId: '14335',
          },
        ]}
      />,
    );
    expect(withQueue).toContain('data-testid="on-deck-strip"');
    expect(withQueue).toContain('Sola');
  });
});
