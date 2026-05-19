import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // React 19 auto-jsx so MockBanner-style Server Components can be unit-tested
  // without importing React explicitly. Matches the Next 15 default.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@mbfd/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@mbfd/worker': path.resolve(__dirname, '../../apps/worker/src/index.ts'),
    },
  },
});
