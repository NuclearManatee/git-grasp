import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@git-help/core': path.join(root, 'packages/core/src/index.js'),
      '@git-help/core/adapter': path.join(root, 'packages/core/src/db/adapter.js'),
      '@git-help/core/lib': path.join(root, 'packages/core/src/lib'),
      '@git-help/core/catalog': path.join(root, 'packages/core/src/catalog'),
      '@git-help/core/eval': path.join(root, 'packages/core/src/eval'),
      '@git-help/core/search': path.join(root, 'packages/core/src/search'),
      '@git-help/core/db': path.join(root, 'packages/core/src/db'),
      '@git-help/core/ux': path.join(root, 'packages/core/src/ux'),
    },
  },
});
