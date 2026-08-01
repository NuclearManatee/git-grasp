/**
 * Mocked full build pipeline proof (Phase 9 without live LLM/OpenAI).
 * Uses fixture sources + mocked generate/validate/intents/eval.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBuildLoop } from '../packages/core/src/build/orchestrator.ts';
import { validateInSandboxAndDestroy } from '../packages/core/src/build/sandbox.ts';

process.env.GIT_GRASP_MOCK_EMBEDDINGS = '1';

const dir = mkdtempSync(path.join(tmpdir(), 'gh-pipeline-'));
const stagingPath = path.join(dir, 'staging.db');
const prodPath = path.join(dir, 'prod.db');

const result = await runBuildLoop({
  stagingPath,
  prodPath,
  mock: true,
  maxIterations: 2,
  batchSize: 2,
  concurrency: 2,
  exitZeroStreak: 2,
  continueOnEvalKo: false,
  prepareEmbedder: {
    embedMany: async (texts) => texts.map((_, i) => [1, i * 0.01, 0]),
  },
  sources: [
    {
      origin: 'fixture-status.md',
      text: '## Status\n\nShow status.\n\n```\ngit status\n```\n',
    },
    {
      origin: 'fixture-log.md',
      text: '## History\n\nView log.\n\n```\ngit log --oneline\n```\n',
    },
  ],
  generate: async (group) => {
    const cmd = group.snippet?.includes('log') ? 'git log --oneline' : 'git status';
    return {
      initial_state: 'git commit --allow-empty -m init\n',
      command_recipe: { commands: [{ command: cmd, comment: 'from fixture' }] },
      risk: 0.1,
    };
  },
  validate: (g) => validateInSandboxAndDestroy(g),
  expandIntents: async () => [
    {
      skill_level: 'beginner',
      intent_category: 'goal',
      intent_text: 'show repository status please',
    },
  ],
  generateGolden: async (_row, id) => ({
    query_text: 'show repository status please',
    command_id: id,
    kind: 'golden',
  }),
  expandQueries: async (seed) => [
    { query_text: 'help status broken', command_id: seed.command_id, kind: 'extended' },
    { query_text: 'how to see status', command_id: seed.command_id, kind: 'extended' },
    { query_text: 'git status?', command_id: seed.command_id, kind: 'extended' },
  ],
  evolve: async (parent) => ({
    initial_state: `${parent.initial_state}echo dirty > f.txt\n`,
    command_recipe: JSON.parse(parent.command_recipe),
    risk: Math.min(1, Number(parent.risk) + 0.1),
  }),
  llmJsonObject: async ({ schema }) => {
    // strict judge fallback
    if (schema?.shape?.confidence) {
      return { confidence: 0.95, reason: 'mock pass' };
    }
    return { confidence: 0.95, reason: 'mock' };
  },
});

console.log(JSON.stringify(result, null, 2));
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* */
}
process.exit(result.ok ? 0 : 1);
