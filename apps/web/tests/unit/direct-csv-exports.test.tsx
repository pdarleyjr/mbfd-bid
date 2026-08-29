import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DirectCsvExports } from '../../app/admin/exports/_components/DirectCsvExports';

describe('DirectCsvExports', () => {
  it('offers snapshot-bound progress and award downloads through the authenticated admin proxy', () => {
    const html = renderToString(<DirectCsvExports sessionId="session / test" />);

    expect(html).toContain('Download Bid progress (CSV)');
    expect(html).toContain('Download current awards / final results (CSV)');
    expect(html).toContain('/api/admin/exports/session%20%2F%20test/progress.csv');
    expect(html).toContain(
      '/api/admin/placements/export?session_id=session%20%2F%20test&amp;format=csv',
    );
    expect(html).toContain('do not publish to the Employee Portal');
  });
});
