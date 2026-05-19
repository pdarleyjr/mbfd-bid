import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MockBanner } from '../../app/_components/MockBanner';

describe('MockBanner Server Component (Task R7)', () => {
  it('renders the sticky red MOCK SESSION banner when isMock=true', () => {
    const html = renderToString(<MockBanner isMock={true} sessionId="01HZZSESS" />);
    expect(html).toContain('MOCK SESSION');
    expect(html).toContain('NOT LIVE');
    expect(html).toContain('01HZZSESS');
    // Must include the data attribute so e2e tests can target the banner.
    expect(html).toContain('data-testid="mock-banner"');
  });

  it('renders nothing (empty string) when isMock=false', () => {
    const html = renderToString(<MockBanner isMock={false} sessionId="01HZZSESS" />);
    expect(html).toBe('');
  });
});
