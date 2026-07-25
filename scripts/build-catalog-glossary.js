#!/usr/bin/env node
/**
 * Step 0: Generate concrete token glossary for catalog examples.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../src/lib/paths.js';
import { loadEnv, requireLlmKey } from '../src/lib/env.js';
import { llmJsonObject } from '../src/lib/llm.js';
import { createRateLimiter, estimateTokensFromMessages } from '../src/lib/rateLimit.js';
import { generateGlossary, DEFAULT_GLOSSARY, mergeGlossary } from '../src/catalog/step0Glossary.js';

loadEnv();

const outDir = path.join(PACKAGE_ROOT, 'data', 'catalog');
const localDir = path.join(PACKAGE_ROOT, 'local', 'catalog');
mkdirSync(outDir, { recursive: true });
mkdirSync(localDir, { recursive: true });

const outPath = path.join(outDir, 'glossary.json');
const skipLlm = process.env.GIT_HELP_GLOSSARY_DEFAULT === '1' || process.argv.includes('--default');

if (skipLlm) {
  writeFileSync(outPath, `${JSON.stringify(DEFAULT_GLOSSARY, null, 2)}\n`);
  console.log('Wrote default glossary', outPath);
  process.exit(0);
}

requireLlmKey();
const lim = createRateLimiter({
  statePath: path.join(localDir, 'llm-day.json'),
  checkpointPath: path.join(localDir, 'glossary-checkpoint.json'),
});

try {
  const glossary = await generateGlossary({
    llmJson: llmJsonObject,
    schedule: (fn, opts) => lim.schedule(fn, {
      estimatedTokens: opts?.estimatedTokens || 1500,
      ...opts,
    }),
  });
  writeFileSync(outPath, `${JSON.stringify(glossary, null, 2)}\n`);
  console.log('Wrote glossary', outPath);
} catch (e) {
  if (e.code === 'RATE_LIMIT_PAUSE') {
    console.error('Rate pause — re-run or use --default');
    process.exit(20);
  }
  console.error('Glossary LLM failed, writing default:', e.message);
  const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};
  writeFileSync(outPath, `${JSON.stringify(mergeGlossary(DEFAULT_GLOSSARY, existing), null, 2)}\n`);
}
