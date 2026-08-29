import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SessionSelectionPanel } from '../../app/admin/exports/_components/SessionSelectionPanel';

describe('SessionSelectionPanel', () => {
  it('offers a human-readable active-session link instead of an opaque identifier form', () => {
    const html = renderToString(
      <SessionSelectionPanel
        activeSession={{ id: 'opaque-session', bidYear: 2026, isMock: true, currentPhase: 'bid' }}
        error={null}
      />,
    );

    expect(html).toMatch(/Open\s*(?:<!-- -->)?2026 rehearsal session exports/);
    expect(html).toContain('/admin/exports?session_id=opaque-session');
    expect(html).not.toContain('Bid session ID');
    expect(html).not.toContain('<input');
  });

  it('leaves export selection blocked with a recovery instruction when no verified active session is available', () => {
    const html = renderToString(<SessionSelectionPanel activeSession={null} error={null} />);

    expect(html).toContain('No active session is available');
    expect(html).toContain('Open exports from a Bid session&#x27;s session controls');
    expect(html).not.toContain('<input');
  });
});
