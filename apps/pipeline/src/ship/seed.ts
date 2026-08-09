#!/usr/bin/env bun
// @ts-nocheck
import { seedCatalog } from '@git-grasp/common';

const forceMock = process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1' || process.argv.includes('--mock');

try {
  const result = await seedCatalog({ forceMock });
  console.log(`Seeded ${result.recipes} recipes / ${result.n} intents (skipped ${result.skipped}) → ${result.dbPath}`);
  console.log(`sha256 ${result.hash}`);
  console.log(`embeddings: ${result.mock ? 'mock' : 'Xenova/bge-small-en-v1.5'}`);
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
