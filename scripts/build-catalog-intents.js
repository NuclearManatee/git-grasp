#!/usr/bin/env node
/**
 * Step 2: ONE example → ONE LLM call for intents (no multi-example batching).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../src/lib/paths.js';
import { loadEnv, requireLlmKey } from '../src/lib/env.js';
import { llmJsonObject } from '../src/lib/llm.js';
import { createRateLimiter } from '../src/lib/rateLimit.js';
import { getProvider } from '../src/lib/providers.js';
import { generateIntentsForExample } from '../src/catalog/step2Intents.js';
import { DEFAULT_GLOSSARY } from '../src/catalog/step0Glossary.js';

loadEnv();
requireLlmKey();

const outDir = path.join(PACKAGE_ROOT, 'data', 'catalog');
const localDir = path.join(PACKAGE_ROOT, 'local', 'catalog');
mkdirSync(localDir, { recursive: true });

const examplesPath = existsSync(path.join(outDir, 'examples.json'))
  ? path.join(outDir, 'examples.json')
  : path.join(outDir, 'commands.json');
if (!existsSync(examplesPath)) {
  console.error('Missing examples.json/commands.json — run build-catalog:commands (+ families) first');
  process.exit(1);
}

const glossaryPath = path.join(outDir, 'glossary.json');
const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;

const examples = JSON.parse(readFileSync(examplesPath, 'utf8'));
const intentsPath = path.join(outDir, 'intents.raw.jsonl');
const provider = getProvider();
const lim = createRateLimiter({
  statePath: path.join(localDir, 'llm-day.json'),
  checkpointPath: path.join(localDir, 'step2-checkpoint.json'),
});

const maxExamples = Number(process.env.GIT_HELP_MAX_INTENT_COMMANDS || 0) || examples.length;
const start = lim.getCursor();
if (start === 0 && !existsSync(intentsPath)) writeFileSync(intentsPath, '');
const end = Math.min(examples.length, maxExamples);

console.log(
  `Step2 (per-example, concurrency=${lim.concurrency}): intents for [${start}..${end}) of ${examples.length} via ${provider.id}`,
);

/** @type {Map<number, object[]>} */
const finished = new Map();
let contiguous = start;
let writeChain = Promise.resolve();

function flushContiguous() {
  writeChain = writeChain.then(() => {
    while (finished.has(contiguous)) {
      const rows = finished.get(contiguous);
      finished.delete(contiguous);
      for (const row of rows) appendFileSync(intentsPath, `${JSON.stringify(row)}\n`);
      contiguous += 1;
      lim.setCursor(contiguous, { lastFlushed: contiguous });
    }
  });
  return writeChain;
}

try {
  const indices = [];
  for (let i = start; i < end; i += 1) indices.push(i);

  const tasks = indices.map((i) => async () => {
    const entry = examples[i];
    let rows = [];
    try {
      rows = await generateIntentsForExample(entry, {
        llmJson: llmJsonObject,
        schedule: (fn, opts) => lim.schedule(fn, opts),
        glossary,
      });
    } catch (err) {
      if (err.code === 'RATE_LIMIT_PAUSE') throw err;
      console.error(`example failed at ${i} (${entry.example}): ${err.message} — skipping`);
      rows = [];
    }
    finished.set(i, rows);
    await flushContiguous();
    if (contiguous % 10 === 0 || contiguous === end || i + 1 === end) {
      console.log(`intents progress contiguous=${contiguous}/${end} (finished idx ${i}, +${rows.length} rows)`);
    }
    return rows.length;
  });

  await lim.mapPool(tasks);
  await writeChain;
  console.log('Step2 done:', intentsPath);
  console.log('Day usage', lim.getDayUsage());
} catch (e) {
  await writeChain.catch(() => {});
  if (e.code === 'RATE_LIMIT_PAUSE') {
    console.error(`Quota/rate pause at ${lim.getCursor()}/${examples.length} — re-run to resume`);
    process.exit(20);
  }
  console.error(e);
  process.exit(1);
}
