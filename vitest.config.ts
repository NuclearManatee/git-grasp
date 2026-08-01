import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      'bun:sqlite': path.join(root, 'test/stubs/bun-sqlite.ts'),
      '@git-grasp/common': path.join(root, 'common/src/index.ts'),
      '@git-grasp/common/adapter': path.join(root, 'common/src/db/adapter.ts'),
      '@git-grasp/common/schemas': path.join(root, 'common/src/schemas/index.ts'),
      '@git-grasp/common/lib': path.join(root, 'common/src/lib'),
      '@git-grasp/common/catalog': path.join(root, 'common/src/catalog'),
      '@git-grasp/common/eval': path.join(root, 'common/src/eval'),
      '@git-grasp/common/search': path.join(root, 'common/src/search'),
      '@git-grasp/common/db': path.join(root, 'common/src/db'),
      '@git-grasp/common/ux': path.join(root, 'common/src/ux'),
    },
  },
});
