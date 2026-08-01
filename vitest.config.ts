import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@git-grasp/core': path.join(root, 'packages/core/src/index.ts'),
      '@git-grasp/core/adapter': path.join(root, 'packages/core/src/db/adapter.ts'),
      '@git-grasp/core/schemas': path.join(root, 'packages/core/src/schemas/index.ts'),
      '@git-grasp/core/lib': path.join(root, 'packages/core/src/lib'),
      '@git-grasp/core/catalog': path.join(root, 'packages/core/src/catalog'),
      '@git-grasp/core/eval': path.join(root, 'packages/core/src/eval'),
      '@git-grasp/core/search': path.join(root, 'packages/core/src/search'),
      '@git-grasp/core/db': path.join(root, 'packages/core/src/db'),
      '@git-grasp/core/ux': path.join(root, 'packages/core/src/ux'),
    },
  },
});
