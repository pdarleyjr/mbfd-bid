import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AnnualPolicyWorkspace } from '../../app/admin/annual-policy/AnnualPolicyWorkspace';

describe('AnnualPolicyWorkspace', () => {
  it('starts blocked and exposes real source-backed policy controls without generated authority', () => {
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <AnnualPolicyWorkspace year={2027} documents={[]} loadError={null} />
      </QueryClientProvider>,
    );

    expect(html).toContain('EDITING FORM INCOMPLETE');
    expect(html).toContain('Bid stages and order');
    expect(html).toContain('Live action authority');
    expect(html).toContain('What happens when a member does not select?');
    expect(html).toContain('Contact policy');
    expect(html).toContain('Specialty policy');
    expect(html).toContain('A-Day deterministic limits');
    expect(html).not.toContain('POLICY_STAGE_');
    expect(html).not.toContain('only initial operator');
  });
});
