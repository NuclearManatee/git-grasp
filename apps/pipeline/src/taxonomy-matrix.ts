// @ts-nocheck
/**
 * Build intent_matrix.json via Flash draft/rewrite + Pro blind judge.
 * Requires DEEPSEEK_API_KEY. Always starts fresh (ignores existing matrix).
 *
 * Exit 0 only when all 16 cells pass. Non-zero after 10 consecutive failed rounds.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../../../common/src/lib/env.ts';
import { runIntentMatrixBuild } from '../../../common/src/build/intentMatrix.ts';

loadEnv();
delete process.env.GIT_GRASP_MOCK_EMBEDDINGS;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const result = await runIntentMatrixBuild({ fresh: true });

console.log(
  JSON.stringify(
    {
      cwd: root,
      ok: result.ok,
      rounds: result.rounds,
      outPath: result.outPath,
      failStreak: result.failStreak ?? 0,
    },
    null,
    2,
  ),
);

if (!result.ok) process.exit(1);
