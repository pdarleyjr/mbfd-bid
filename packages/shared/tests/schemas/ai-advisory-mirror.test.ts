import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = fileURLToPath(import.meta.url);
const root = resolve(here, '../../../../../');

describe('ai-advisory schema sync', () => {
  it('worker copy and shared copy are byte-identical (modulo comment headers)', () => {
    const worker = readFileSync(resolve(root, 'apps/worker/src/ai/output-schema.ts'), 'utf8');
    const shared = readFileSync(
      resolve(root, 'packages/shared/src/schemas/ai-advisory.ts'),
      'utf8',
    );
    const stripHeader = (s: string) =>
      s
        .split('\n')
        .filter((l) => !l.startsWith('//'))
        .join('\n');
    expect(stripHeader(worker)).toBe(stripHeader(shared));
  });
});
