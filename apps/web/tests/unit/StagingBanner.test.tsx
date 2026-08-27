import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StagingBanner } from '../../app/_components/StagingBanner';

describe('StagingBanner', () => {
  it('renders an obvious non-production warning only in staging', () => {
    const html = renderToString(<StagingBanner environment="staging" />);

    expect(html).toContain('STAGING');
    expect(html).toContain('TESTING ONLY');
    expect(html).toContain('data-testid="staging-banner"');
  });

  it('does not render in an unset or non-staging environment', () => {
    expect(renderToString(<StagingBanner environment={undefined} />)).toBe('');
    expect(renderToString(<StagingBanner environment="production" />)).toBe('');
  });
});
