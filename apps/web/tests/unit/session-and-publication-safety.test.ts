import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

function source(relativePath: string) {
  return readFileSync(resolve(webRoot, relativePath), 'utf8');
}

describe('session entry and publication safety copy', () => {
  it('makes rehearsal the session-creation default and routes an empty Live Bid state there', () => {
    expect(source('app/admin/sessions/new/NewSessionForm.tsx')).toContain('defaultMock = true');
    expect(source('app/admin/sessions/new/NewSessionForm.tsx')).toContain("mode: isMock ? 'mock' : 'live'");
    expect(source('app/admin/bid/page.tsx')).toContain('/admin/sessions/new?mock=1');
  });

  it('does not promise that a publish request will promote a draft', () => {
    const publishButton = source('app/admin/rule-books/[version]/PublishButton.tsx');

    expect(publishButton).toContain('Review publication gate');
    expect(publishButton).toContain('does not guarantee publication');
    expect(publishButton).not.toContain('This will archive the currently active book');
  });

  it('keeps annual configuration and rehearsal freeze on their designated endpoints', () => {
    const bidSetupPage = source('app/admin/bid-setup/page.tsx');
    const bidSetupWorkspace = source('app/admin/bid-setup/BidSetupWorkspace.tsx');
    const mockFreezeButton = source('app/admin/bid/_components/MockFreezeButton.tsx');

    expect(bidSetupPage).toContain('/api/admin/bid-configuration/${year}');
    expect(bidSetupPage).toContain('/api/admin/rule-books?effective_year=${year}');
    expect(bidSetupWorkspace).toContain('/api/admin/bid-configuration/${year}');
    expect(mockFreezeButton).toContain(
      '/api/admin/rehearsal/${encodeURIComponent(bidSessionId)}/commands/freeze',
    );
    expect(mockFreezeButton).not.toContain('/api/admin/bid/freeze');
  });
});
