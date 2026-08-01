/**
 * Ground Step 0→4 from durable Step −1 blocks (does NOT run prepare).
 */
import { loadEnv } from '../packages/core/src/lib/env.ts';
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runGroundStep } from '../packages/core/src/build/orchestrator.ts';
import {
  PACKAGE_ROOT,
  semanticBlocksPath,
  buildCacheDir,
} from '../packages/core/src/lib/paths.ts';

loadEnv();
delete process.env.GIT_GRASP_MOCK_EMBEDDINGS;

if (!existsSync(semanticBlocksPath())) {
  console.error(`Missing Step −1 artifact: ${semanticBlocksPath()}`);
  console.error('Run first: bun run build:prepare');
  process.exit(1);
}

const groups = JSON.parse(readFileSync(semanticBlocksPath(), 'utf8'));
console.log(`Using Step −1 blocks: ${groups.length} groups from ${semanticBlocksPath()}`);

mkdirSync(buildCacheDir(), { recursive: true });
const evalDir = path.join(PACKAGE_ROOT, 'data', 'eval');
if (existsSync(evalDir)) rmSync(evalDir, { recursive: true, force: true });

console.log('Running ground (Step 0 / Generation → Validation → Dedup → Intents)…');
const result = await runGroundStep({
  fresh: true,
  mock: false,
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok || result.inserted > 0 ? 0 : 1);
