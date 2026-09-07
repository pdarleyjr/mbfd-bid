import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CredentialsCatalogWorkspace } from '../../app/admin/credentials/CredentialsCatalogWorkspace';

describe('CredentialsCatalogWorkspace', () => {
  it('separates editable catalog defaults from effective-dated qualification evidence', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <CredentialsCatalogWorkspace
          initialCredentials={[
            { id: 13, name: 'Synthetic Credential', fyPointsDefault: 0, holderCount: 2 },
          ]}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain('Credentials &amp; Specialty Points');
    expect(html).toContain('Add credential');
    expect(html).toContain('Default points');
    expect(html).toContain('Referenced members');
    expect(html).toContain('Record qualification evidence');
    expect(html).toContain('these defaults do not rewrite any frozen annual Bid score');
    expect(html).toContain('Display-name changes preserve the stable credential identity');
  });
});
