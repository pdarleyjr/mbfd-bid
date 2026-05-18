import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@mbfd/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
