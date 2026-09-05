import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const activeAdminSources = [
  'app/admin/page.tsx',
  'components/admin/AdminShell.tsx',
  'app/admin/guide/guide-content.ts',
].map((path) => readFileSync(resolve(webRoot, path), 'utf8'));
const bidSocketHook = readFileSync(resolve(webRoot, 'app/bid/_hooks/useBidWebSocket.ts'), 'utf8');

describe('retired AI references', () => {
  it('does not advertise or route to the retired generative advisory workspace', () => {
    for (const source of activeAdminSources) {
      expect(source).not.toMatch(/AI Assist|Workers AI|\/admin\/ai-assist/i);
    }
  });

  it('does not invalidate a query for a retired AI endpoint after bid events', () => {
    expect(bidSocketHook).not.toContain('ai-advise-current');
  });
});
