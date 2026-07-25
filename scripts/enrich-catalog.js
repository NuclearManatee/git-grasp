#!/usr/bin/env bun
/**
 * Enrich examples with golden + essentials, then generate intents for gaps.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '@git-help/core';
import { loadEnv, requireLlmKey } from '@git-help/core/lib/env.js';
import { llmJsonObject } from '@git-help/core/lib/llm.js';
import { createRateLimiter } from '@git-help/core/lib/rateLimit.js';
import { generateIntentsForExample } from '@git-help/core/catalog/step2Intents.js';
import {
  enrichCommandsFromEssentials,
  enrichCommandsFromGolden,
  commandsMissingIntents,
} from '@git-help/core/catalog/enrich.js';
import { normalizeCommands } from '@git-help/core/catalog/step3Normalize.js';
import { assignFamiliesHeuristic } from '@git-help/core/catalog/step1bFamilies.js';
import { DEFAULT_GLOSSARY } from '@git-help/core/catalog/step0Glossary.js';

loadEnv();
requireLlmKey();

const outDir = path.join(PACKAGE_ROOT, 'data', 'catalog');
const localDir = path.join(PACKAGE_ROOT, 'local', 'catalog');
mkdirSync(localDir, { recursive: true });

const commandsPath = path.join(outDir, 'commands.json');
const intentsRawPath = path.join(outDir, 'intents.raw.jsonl');
const goldenPath = path.join(PACKAGE_ROOT, 'eval', 'golden', 'cases.json');
const glossaryPath = path.join(outDir, 'glossary.json');
const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;

if (!existsSync(commandsPath)) {
  console.error('Missing commands.json');
  process.exit(1);
}

let commands = JSON.parse(readFileSync(commandsPath, 'utf8'));
const golden = existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, 'utf8')) : [];
const before = commands.length;
commands = enrichCommandsFromEssentials(commands, undefined, glossary);
commands = enrichCommandsFromGolden(commands, golden, glossary);
const { commands: normalized, allowlist } = normalizeCommands(commands, { glossary });
commands = assignFamiliesHeuristic(normalized);
writeFileSync(commandsPath, `${JSON.stringify(commands, null, 2)}\n`);
writeFileSync(path.join(outDir, 'examples.json'), `${JSON.stringify(commands, null, 2)}\n`);
writeFileSync(path.join(outDir, 'command-allowlist.json'), `${JSON.stringify(allowlist, null, 2)}\n`);
console.log(`Enriched examples ${before} → ${commands.length}`);

const existing = existsSync(intentsRawPath)
  ? readFileSync(intentsRawPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];
const missing = commandsMissingIntents(commands, existing);
console.log(`Missing intents for ${missing.length} examples`);

if (missing.length === 0) {
  console.log('Nothing to generate');
  process.exit(0);
}

const lim = createRateLimiter({
  statePath: path.join(localDir, 'llm-day.json'),
  checkpointPath: path.join(localDir, 'enrich-intents-checkpoint.json'),
});

if (!existsSync(intentsRawPath)) writeFileSync(intentsRawPath, '');

let writeChain = Promise.resolve();
function appendRows(rows) {
  writeChain = writeChain.then(() => {
    for (const row of rows) appendFileSync(intentsRawPath, `${JSON.stringify(row)}\n`);
  });
  return writeChain;
}

let done = 0;
const tasks = missing.map((entry) => async () => {
  let rows = [];
  try {
    rows = await generateIntentsForExample(entry, {
      llmJson: llmJsonObject,
      schedule: (fn, opts) => lim.schedule(fn, opts),
      glossary,
      common: entry.source_hint === 'essential' || Number(entry.simplicity_rank) === 1,
    });
  } catch (err) {
    if (err.code === 'RATE_LIMIT_PAUSE') throw err;
    console.error(`enrich fail ${entry.example}: ${err.message}`);
  }
  await appendRows(rows);
  done += 1;
  if (done % 5 === 0 || done === missing.length) {
    console.log(`enrich intents ${done}/${missing.length}`);
  }
  return rows.length;
});

await lim.mapPool(tasks);
await writeChain;
console.log('Enrich intents done');
