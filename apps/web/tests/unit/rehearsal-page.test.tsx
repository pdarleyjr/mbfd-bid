// Plan 09 / Rehearsal Tooling — Task R9 smoke tests.
//
// Vitest cannot execute the Next.js page Server Component end-to-end
// (cookies(), getRequestContext(), cfEnv() all need a real edge request),
// so this test exercises just the row + form components in isolation.

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MockSessionsTable } from '../../app/admin/rehearsal/_components/MockSessionsTable';
import { NewFindingForm } from '../../app/admin/rehearsal/_components/NewFindingForm';

describe('Rehearsal dashboard pieces (Task R9)', () => {
  it('MockSessionsTable renders rows for each mock session', () => {
    const html = renderToString(
      <MockSessionsTable
        sessions={[
          {
            id: '01HZZSESS01',
            bidYear: 2026,
            currentPhase: 'position_bid',
            currentBidderId: 101,
            isMock: true,
            costCents: 42,
            lastPickedAtIso: '2026-09-22T14:30:00Z',
          },
          {
            id: '01HZZSESS02',
            bidYear: 2026,
            currentPhase: 'a_day_bid',
            currentBidderId: 202,
            isMock: true,
            costCents: 0,
            lastPickedAtIso: null,
          },
        ]}
      />,
    );
    expect(html).toContain('01HZZSESS01');
    expect(html).toContain('01HZZSESS02');
    expect(html).toContain('position_bid');
    expect(html).toContain('a_day_bid');
  });

  it('MockSessionsTable shows empty state when no sessions are mock', () => {
    const html = renderToString(<MockSessionsTable sessions={[]} />);
    expect(html).toContain('No mock sessions yet');
  });

  it('NewFindingForm renders the inputs the operator needs', () => {
    const html = renderToString(<NewFindingForm sessionIds={['01HZZSESS01', '01HZZSESS02']} />);
    expect(html).toContain('Submit Finding');
    expect(html).toContain('01HZZSESS01');
    expect(html).toContain('01HZZSESS02');
  });
});
