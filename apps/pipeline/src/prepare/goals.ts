// @ts-nocheck
/**
 * Build goal_taxonomy.json via LLM brainstorm/decompose/map/reflect.
 * Prerequisites: common/taxonomy/git_commands.json (taxonomy:scrape).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../../../../common/src/lib/env.ts';
import { buildGoalTaxonomy } from '../../../../common/src/build/goalTaxonomy.ts';

loadEnv();
delete process.env.GIT_GRASP_MOCK_EMBEDDINGS;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const result = await buildGoalTaxonomy({ fresh: true });

console.log(
  JSON.stringify(
    {
      cwd: root,
      ok: result.ok,
      outPath: result.outPath,
      leaves: result.leaves?.length ?? 0,
      coverage: result.coverage,
      reflection_rounds: result.reflection_rounds,
    },
    null,
    2,
  ),
);

if (!result.ok) process.exit(1);
