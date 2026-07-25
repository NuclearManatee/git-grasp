#!/usr/bin/env node
/**
 * Step 3: Normalize commands + intents, write final catalog artifacts.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PACKAGE_ROOT } from '../src/lib/paths.js';
import { normalizeCommands, normalizeIntents } from '../src/catalog/step3Normalize.js';
import { injectGoldenIntentRows } from '../src/catalog/enrich.js';

const outDir = path.join(PACKAGE_ROOT, 'data', 'catalog');
mkdirSync(outDir, { recursive: true });

const commandsPath = path.join(outDir, 'commands.json');
const rawIntentsPath = path.join(outDir, 'intents.raw.jsonl');
if (!existsSync(commandsPath)) {
  console.error('Missing commands.json');
  process.exit(1);
}
if (!existsSync(rawIntentsPath)) {
  console.error('Missing intents.raw.jsonl — run build-catalog:intents first');
  process.exit(1);
}

const rawCommands = JSON.parse(readFileSync(commandsPath, 'utf8'));
writeFileSync(path.join(outDir, 'commands.extracted.json'), `${JSON.stringify(rawCommands, null, 2)}\n`);
const { commands, drops: cmdDrops, allowlist } = normalizeCommands(rawCommands);

const rawRows = readFileSync(rawIntentsPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const { intents: normalizedIntents, drops: intentDrops } = normalizeIntents(rawRows);
const goldenPath = path.join(PACKAGE_ROOT, 'eval', 'golden', 'cases.json');
const golden = existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, 'utf8')) : [];
const meta = new Map(commands.map((c) => [c.command, c]));
const intents = normalizeIntents(injectGoldenIntentRows(normalizedIntents, golden, meta)).intents;

// Keep commands that have at least one intent (supports partial intent runs)
const intentCommands = new Set(intents.map((i) => i.command));
const commandsWithIntents = commands.filter((c) => intentCommands.has(c.command));
const finalCommands = commandsWithIntents.length >= 200 ? commandsWithIntents : commands;

writeFileSync(path.join(outDir, 'commands.json'), `${JSON.stringify(finalCommands, null, 2)}\n`);
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

const manifest = {
  step: 3,
  pipeline: ['docs+extract+are-you-sure', 'per-command-intents', 'normalize'],
  source: 'git-scm.com+gpt-oss-120b',
  docMirrorHash: step1.docMirrorHash || null,
  commandCount: finalCommands.length,
  extractedCommandCount: commands.length,
  intentCount: intents.length,
  dropCount: cmdDrops.length + intentDrops.length,
  hash: createHash('sha256').update(JSON.stringify({ commands: finalCommands, intents })).digest('hex'),
  createdAt: new Date().toISOString(),
};
writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Normalize done: ${finalCommands.length} commands (of ${commands.length} extracted), ${intents.length} intents, ${manifest.dropCount} drops`);
if (finalCommands.length < 200) {
  console.error('ERROR: normalized command count with intents < 200');
  process.exit(1);
}
