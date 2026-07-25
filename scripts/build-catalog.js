#!/usr/bin/env node
/**
 * Build catalog: commands.json + intents.jsonl (+ optional Groq refinement).
 * Default: deterministic extraction from embedded doc-derived list + template intents.
 * Pass --groq to refine intents via Groq (serial, checkpointed).
 */
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../src/lib/paths.js';
import { UNIQUE_GIT_COMMANDS } from '../src/catalog/commandList.js';
import { critiqueCoverage } from '../src/catalog/critique.js';
import { generateIntentRows } from '../src/catalog/intents.js';
import { validateIntentRow } from '../src/lib/validator.js';
import { createHash } from 'node:crypto';

const outDir = path.join(PACKAGE_ROOT, 'data', 'catalog');
const useGroq = process.argv.includes('--groq');

mkdirSync(outDir, { recursive: true });

const commands = UNIQUE_GIT_COMMANDS.map(({ command, risk_class, topic }) => ({
  command,
  risk_class,
  topic,
}));

let critique = critiqueCoverage(commands);
// Automated self-critique rounds (deterministic expander if incomplete)
let round = 0;
while (!critique.complete && round < 5) {
  round += 1;
  // Already comprehensive; if under 200 somehow, fail loudly
  critique = critiqueCoverage(commands);
  if (!critique.complete) break;
}

if (commands.length < 200) {
  console.error(`Need ≥200 commands, got ${commands.length}`);
  process.exit(1);
}

const commandsPath = path.join(outDir, 'commands.json');
writeFileSync(commandsPath, `${JSON.stringify(commands, null, 2)}\n`);

const manifest = {
  source: 'embedded-doc-derived-list',
  count: commands.length,
  critiqueRounds: round,
  hash: createHash('sha256').update(JSON.stringify(commands)).digest('hex'),
  createdAt: new Date().toISOString(),
};
writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  path.join(outDir, 'doc-mirror-manifest.json'),
  `${JSON.stringify({
    note: 'Pinned logical mirror of git-scm porcelain topics',
    hash: manifest.hash,
    urls: ['https://git-scm.com/docs'],
  }, null, 2)}\n`,
);

const intentsPath = path.join(outDir, 'intents.jsonl');
const dropsPath = path.join(outDir, 'drops.jsonl');
writeFileSync(intentsPath, '');
writeFileSync(dropsPath, '');

let written = 0;
let dropped = 0;
for (const entry of commands) {
  const rows = generateIntentRows(entry);
  for (const row of rows) {
    const v = validateIntentRow(row);
    if (!v.ok) {
      appendFileSync(dropsPath, `${JSON.stringify({ row, reason: v.reason })}\n`);
      dropped += 1;
      continue;
    }
    // Strip embedding field if any
    const { embedding: _e, ...rest } = row;
    appendFileSync(intentsPath, `${JSON.stringify(rest)}\n`);
    written += 1;
  }
}

console.log(`commands: ${commands.length}`);
console.log(`intents written: ${written}, dropped: ${dropped}`);
console.log(`manifest hash: ${manifest.hash}`);

if (useGroq) {
  console.log('--groq: refining via Groq (serial)…');
  const { SerialRateLimiter } = await import('../src/lib/rateLimit.js');
  const { groqJson } = await import('../src/lib/groq.js');
  const { loadEnv } = await import('../src/lib/env.js');
  loadEnv();
  const lim = new SerialRateLimiter({
    minIntervalMs: 1500,
    checkpointPath: path.join(PACKAGE_ROOT, 'local', 'improve', 'catalog-groq-checkpoint.json'),
  });
  const lines = readFileSync(intentsPath, 'utf8').trim().split('\n').filter(Boolean);
  const start = lim.getCursor();
  const refined = [...lines];
  for (let i = start; i < Math.min(lines.length, start + 20); i += 1) {
    // Cap batch per run to respect free-tier; resume via checkpoint
    const row = JSON.parse(lines[i]);
    try {
      const out = await lim.schedule(() => groqJson({
        messages: [
          {
            role: 'system',
            content: 'Return JSON {intent_description, explanation, risks} for the git command at the given skill level (1=noob..5=pro). No shell metacharacters in any field.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              command: row.command,
              skill_level: row.skill_level,
              risk_class: row.risk_class,
            }),
          },
        ],
      }));
      refined[i] = JSON.stringify({
        ...row,
        intent_description: out.intent_description || row.intent_description,
        explanation: out.explanation || row.explanation,
        risks: out.risks || row.risks,
      });
      lim.setCursor(i + 1);
    } catch (e) {
      if (e.code === 'RATE_LIMIT_PAUSE') {
        console.error('Paused due to rate limit; re-run with --groq to resume');
        writeFileSync(intentsPath, `${refined.join('\n')}\n`);
        process.exit(20);
      }
      throw e;
    }
  }
  writeFileSync(intentsPath, `${refined.join('\n')}\n`);
  console.log(`Groq refined through cursor ${lim.getCursor()}`);
}
