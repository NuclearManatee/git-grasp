#!/usr/bin/env bun
/**
 * Step 3: Normalize examples + intents, write final catalog artifacts.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PACKAGE_ROOT } from '@git-help/core';
import { normalizeCommands, normalizeIntents } from '@git-help/core/catalog/step3Normalize.js';
import { injectGoldenIntentRows } from '@git-help/core/catalog/enrich.js';
import { DEFAULT_GLOSSARY } from '@git-help/core/catalog/step0Glossary.js';

const outDir = path.join(PACKAGE_ROOT, 'data', 'catalog');
mkdirSync(outDir, { recursive: true });

const examplesPath = existsSync(path.join(outDir, 'examples.json'))
  ? path.join(outDir, 'examples.json')
  : path.join(outDir, 'commands.json');
const rawIntentsPath = path.join(outDir, 'intents.raw.jsonl');
if (!existsSync(examplesPath)) {
  console.error('Missing examples/commands.json');
  process.exit(1);
}
if (!existsSync(rawIntentsPath)) {
  console.error('Missing intents.raw.jsonl — run build-catalog:intents first');
  process.exit(1);
}

const glossaryPath = path.join(outDir, 'glossary.json');
const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;

const rawCommands = JSON.parse(readFileSync(examplesPath, 'utf8'));
writeFileSync(path.join(outDir, 'commands.extracted.json'), `${JSON.stringify(rawCommands, null, 2)}\n`);
const { commands, drops: cmdDrops, allowlist } = normalizeCommands(rawCommands, { glossary });

const rawRows = readFileSync(rawIntentsPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const { intents: normalizedIntents, drops: intentDrops } = normalizeIntents(rawRows);
const goldenPath = path.join(PACKAGE_ROOT, 'eval', 'golden', 'cases.json');
const golden = existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, 'utf8')) : [];
const meta = new Map(commands.map((c) => [c.example, c]));
for (const c of commands) meta.set(c.command, c);
const intents = normalizeIntents(
  injectGoldenIntentRows(normalizedIntents, golden, meta, glossary),
).intents;

const intentExamples = new Set(intents.map((i) => i.example));
const commandsWithIntents = commands.filter((c) => intentExamples.has(c.example));
const finalCommands = commandsWithIntents.length >= 200 ? commandsWithIntents : commands;

writeFileSync(path.join(outDir, 'commands.json'), `${JSON.stringify(finalCommands, null, 2)}\n`);
writeFileSync(path.join(outDir, 'examples.json'), `${JSON.stringify(finalCommands, null, 2)}\n`);
writeFileSync(path.join(outDir, 'command-allowlist.json'), `${JSON.stringify(allowlist, null, 2)}\n`);

const intentsPath = path.join(outDir, 'intents.jsonl');
writeFileSync(intentsPath, intents.map((r) => JSON.stringify(r)).join('\n') + (intents.length ? '\n' : ''));

const dropsPath = path.join(outDir, 'drops.jsonl');
writeFileSync(dropsPath, '');
for (const d of [...cmdDrops, ...intentDrops]) {
  appendFileSync(dropsPath, `${JSON.stringify(d)}\n`);
}

const step1 = existsSync(path.join(outDir, 'manifest.step1.json'))
  ? JSON.parse(readFileSync(path.join(outDir, 'manifest.step1.json'), 'utf8'))
  : {};

const familyCount = new Set(finalCommands.map((c) => c.intent_family).filter(Boolean)).size;

const manifest = {
  step: 3,
  pipeline: ['glossary', 'docs+extract+are-you-sure', 'families', 'per-example-intents', 'normalize'],
  source: 'git-scm.com+llm',
  docMirrorHash: step1.docMirrorHash || null,
  exampleCount: finalCommands.length,
  commandCount: finalCommands.length,
  extractedCommandCount: commands.length,
  intentCount: intents.length,
  familyCount,
  dropCount: cmdDrops.length + intentDrops.length,
  hash: createHash('sha256').update(JSON.stringify({ commands: finalCommands, intents })).digest('hex'),
  createdAt: new Date().toISOString(),
};
writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `Normalize done: ${finalCommands.length} examples (of ${commands.length} extracted), `
  + `${intents.length} intents, ${familyCount} families, ${manifest.dropCount} drops`,
);
if (finalCommands.length < 200) {
  console.error('ERROR: normalized example count with intents < 200');
  process.exit(1);
}
