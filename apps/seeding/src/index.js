#!/usr/bin/env bun
import { seedCatalog } from '@git-help/core';

const forceMock = process.env.GIT_HELP_MOCK_EMBEDDINGS === '1' || process.argv.includes('--mock');

try {
  const result = await seedCatalog({ forceMock });
  console.log(`Seeded ${result.n} rows (skipped ${result.skipped}) → ${result.dbPath}`);
  console.log(`sha256 ${result.hash}`);
  console.log(`embeddings: ${result.mock ? 'mock' : 'all-MiniLM-L6-v2'}`);
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
