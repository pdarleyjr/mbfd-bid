import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { RuleBookCreateForm } from '../../app/admin/rule-books/RuleBookCreateForm';

describe('RuleBookCreateForm', () => {
  it('gives an administrator an audited draft or clone workflow without API instructions', () => {
    const html = renderToString(
      <RuleBookCreateForm
        ruleBooks={[
          { version: '2026.2', effectiveYear: 2026, status: 'draft' },
          { version: '2026.1', effectiveYear: 2026, status: 'active' },
        ]}
      />,
    );

    expect(html).toContain('Create draft rule book');
    expect(html).toContain('Effective year');
    expect(html).toContain('Clone source');
    expect(html).toContain('Notes (optional)');
    expect(html).toContain('Reason for this change');
    expect(html).toContain('minLength="4"');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('2026.1');
    expect(html).toContain('data-testid="rule-book-create-form"');
    expect(html).not.toContain('Worker API');
    expect(html).not.toContain('seed script');
  });
});
