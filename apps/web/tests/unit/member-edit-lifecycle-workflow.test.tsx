import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EditForm } from '../../app/admin/members/[id]/edit/EditForm';

describe('legacy member edit entry point', () => {
  it('routes personnel-state changes through the effective-dated workflow', () => {
    const html = renderToString(<EditForm member={{ id: 42 }} />);

    expect(html).toContain('Use the personnel lifecycle workflow');
    expect(html).toContain('effective date and reason');
    expect(html).toContain('/admin/personnel?memberId=42');
    expect(html).not.toContain('Save');
  });
});
