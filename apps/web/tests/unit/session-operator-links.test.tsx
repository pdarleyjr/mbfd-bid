import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SessionOperatorLinks } from '../../app/admin/sessions/[id]/SessionOperatorLinks';

describe('SessionOperatorLinks', () => {
  it('routes an operator from a known session to exports and the guarded current-to-new workflow without asking for an identifier', () => {
    const html = renderToString(<SessionOperatorLinks sessionId="opaque session / 7" />);

    expect(html).toContain('Open session exports');
    expect(html).toContain('Review current-to-new transition');
    expect(html).toContain('/admin/exports?session_id=opaque+session+%2F+7');
    expect(html).toContain('/admin/award-transition?session_id=opaque+session+%2F+7');
    expect(html).not.toContain('Enter a session ID');
  });
});
