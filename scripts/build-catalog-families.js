#!/usr/bin/env bun
/**
 * Step 1b: Assign intent_family + simplicity_rank to examples.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '@git-help/core';
import { loadEnv, requireLlmKey } from '@git-help/core/lib/env.js';
import { llmJsonObject } from '@git-help/core/lib/llm.js';
import { createRateLimiter } from '@git-help/core/lib/rateLimit.js';
import { assignFamiliesAll, assignFamiliesHeuristic } from '@git-help/core/catalog/step1bFamilies.js';
import { normalizeCommands } from '@git-help/core/catalog/step3Normalize.js';
import { DEFAULT_GLOSSARY } from '@git-help/core/catalog/step0Glossary.js';

loadEnv();

const outDir = path.join(PACKAGE_ROOT, 'data', 'catalog');
mkdirSync(outDir, { recursive: true });
const localDir = path.join(PACKAGE_ROOT, 'local', 'catalog');
mkdirSync(localDir, { recursive: true });

const commandsPath = path.join(outDir, 'commands.json');
if (!existsSync(commandsPath)) {
  console.error('Missing commands.json — run build-catalog:commands first');
  process.exit(1);
}

const glossaryPath = path.join(outDir, 'glossary.json');
const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;

const raw = JSON.parse(readFileSync(commandsPath, 'utf8'));
const { commands } = normalizeCommands(raw, { glossary });
const heuristicOnly = process.env.GIT_HELP_FAMILIES_HEURISTIC === '1'
  || process.argv.includes('--heuristic');

let examples;
if (heuristicOnly) {
  examples = assignFamiliesHeuristic(commands);
} else {
  requireLlmKey();
  const lim = createRateLimiter({
    statePath: path.join(localDir, 'llm-day.json'),
    checkpointPath: path.join(localDir, 'families-checkpoint.json'),
  });
  try {
    examples = await assignFamiliesAll(commands, {
      llmJson: llmJsonObject,
      schedule: (fn, opts) => lim.schedule(fn, opts),
      onBatch: (info) => console.log(JSON.stringify({ phase: 'families', ...info })),
    });
  } catch (e) {
    if (e.code === 'RATE_LIMIT_PAUSE') {
      console.error('Rate pause — re-run or use --heuristic');
      process.exit(20);
    }
    throw e;
  }
}

writeFileSync(path.join(outDir, 'examples.json'), `${JSON.stringify(examples, null, 2)}\n`);
writeFileSync(commandsPath, `${JSON.stringify(examples, null, 2)}\n`);
const families = new Set(examples.map((e) => e.intent_family).filter(Boolean));
console.log(`Families done: ${examples.length} examples, ${families.size} families`);
