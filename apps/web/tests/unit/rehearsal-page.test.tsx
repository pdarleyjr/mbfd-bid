// Plan 09 / Rehearsal Tooling — Task R9 smoke tests.
//
// Vitest cannot execute the Next.js page Server Component end-to-end
// (cookies(), getCloudflareContext(), cfEnv() all need a real Worker request),
// so this test exercises just the row + form components in isolation.

import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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
            mockControlRevision: 0,
            isMock: true,
            lastPickedAtIso: '2026-09-22T14:30:00Z',
          },
          {
            id: '01HZZSESS02',
            bidYear: 2026,
            currentPhase: 'a_day_bid',
            currentBidderId: 202,
            mockControlRevision: 3,
            isMock: true,
            lastPickedAtIso: null,
          },
        ]}
      />,
    );
    expect(html).toContain('01HZZSESS01');
    expect(html).toContain('01HZZSESS02');
    expect(html).toContain('position_bid');
    expect(html).toContain('a_day_bid');
    expect(html).toContain('Reset unavailable');
    expect(html).toContain('Requires audited reset epoch');
    expect(html).toContain('Open mock board');
    expect(html).not.toContain('Watch live');
    expect(html).not.toContain('AI cost');
    expect(html).not.toContain('(AI)');
  });

  it('MockSessionsTable shows empty state when no sessions are mock', () => {
    const html = renderToString(<MockSessionsTable sessions={[]} />);
    expect(html).toContain('No mock sessions yet');
    expect(html).toContain('/admin/sessions/new?mock=1');
  });

  it('NewFindingForm renders the inputs the operator needs', () => {
    const html = renderToString(<NewFindingForm sessionIds={['01HZZSESS01', '01HZZSESS02']} />);
    expect(html).toContain('Submit Finding');
    expect(html).toContain('01HZZSESS01');
    expect(html).toContain('01HZZSESS02');
  });
});
