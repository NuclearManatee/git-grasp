#!/usr/bin/env node
/**
 * Step 2: ONE command → ONE LLM call for intents (no multi-command batching).
 * Parallelism is concurrency-limited (DeepSeek account cap = 500).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../src/lib/paths.js';
import { loadEnv, requireLlmKey } from '../src/lib/env.js';
import { llmJsonObject } from '../src/lib/llm.js';
import { createRateLimiter } from '../src/lib/rateLimit.js';
import { getProvider } from '../src/lib/providers.js';
import { generateIntentsForCommand } from '../src/catalog/step2Intents.js';

loadEnv();
requireLlmKey();

const outDir = path.join(PACKAGE_ROOT, 'data', 'catalog');
const localDir = path.join(PACKAGE_ROOT, 'local', 'catalog');
mkdirSync(localDir, { recursive: true });

const commandsPath = path.join(outDir, 'commands.json');
if (!existsSync(commandsPath)) {
  console.error('Missing commands.json — run build-catalog:commands first');
  process.exit(1);
}

const commands = JSON.parse(readFileSync(commandsPath, 'utf8'));
const intentsPath = path.join(outDir, 'intents.raw.jsonl');
const provider = getProvider();
const lim = createRateLimiter({
  statePath: path.join(localDir, 'llm-day.json'),
  checkpointPath: path.join(localDir, 'step2-checkpoint.json'),
});

const maxCommands = Number(process.env.GIT_HELP_MAX_INTENT_COMMANDS || 0) || commands.length;
const start = lim.getCursor();
if (start === 0 && !existsSync(intentsPath)) writeFileSync(intentsPath, '');
const end = Math.min(commands.length, maxCommands);

console.log(
  `Step2 (no batch, concurrency=${lim.concurrency}): intents for [${start}..${end}) of ${commands.length} via ${provider.id}`,
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
    const entry = commands[i];
    let rows = [];
    try {
      rows = await generateIntentsForCommand(entry, {
        llmJson: llmJsonObject,
        schedule: (fn, opts) => lim.schedule(fn, opts),
      });
    } catch (err) {
      if (err.code === 'RATE_LIMIT_PAUSE') throw err;
      console.error(`command failed at ${i} (${entry.command}): ${err.message} — skipping`);
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
    console.error(`Quota/rate pause at ${lim.getCursor()}/${commands.length} — re-run to resume`);
    process.exit(20);
  }
  console.error(e);
  process.exit(1);
}
