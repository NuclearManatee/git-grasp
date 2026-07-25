#!/usr/bin/env bun
/**
 * Step 1: Local docs → LLM extract command+examples → Are You Sure? loops.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PACKAGE_ROOT } from '@git-help/core';
import { loadEnv, requireLlmKey } from '@git-help/core/lib/env.js';
import { llmJsonObject } from '@git-help/core/lib/llm.js';
import { createRateLimiter, estimateTokensFromMessages } from '@git-help/core/lib/rateLimit.js';
import { getProvider } from '@git-help/core/lib/providers.js';
import { loadLocalDocs } from '@git-help/core/catalog/downloadDocs.js';
import {
  mergeCommands,
  buildExtractorSystem,
  buildAreYouSureSystem,
  groupByCommand,
} from '@git-help/core/catalog/step1Commands.js';
import { TOPIC_CHECKLIST, critiqueCoverage } from '@git-help/core/catalog/critique.js';
import { normalizeCommands } from '@git-help/core/catalog/step3Normalize.js';
import { DEFAULT_GLOSSARY } from '@git-help/core/catalog/step0Glossary.js';

loadEnv();
requireLlmKey();

const outDir = path.join(PACKAGE_ROOT, 'data', 'catalog');
const localDir = path.join(PACKAGE_ROOT, 'local', 'catalog');
mkdirSync(outDir, { recursive: true });
mkdirSync(localDir, { recursive: true });

const glossaryPath = path.join(outDir, 'glossary.json');
const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;

const EXTRACTOR_SYSTEM = buildExtractorSystem(glossary);
const ARE_YOU_SURE_SYSTEM = buildAreYouSureSystem(glossary);

const provider = getProvider();
const statePath = path.join(localDir, 'step1-state.json');
const lim = createRateLimiter({
  statePath: path.join(localDir, 'llm-day.json'),
  checkpointPath: path.join(localDir, 'step1-rate-checkpoint.json'),
});

function loadState() {
  if (existsSync(statePath)) return JSON.parse(readFileSync(statePath, 'utf8'));
  return { phase: 'extract', pageIndex: 0, commands: [], aysRound: 0, rounds: [] };
}
function saveState(state) {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

const pages = loadLocalDocs(PACKAGE_ROOT);
console.log(`Loaded ${pages.length} local doc pages via ${provider.id}/${provider.defaultModel}`);

const minCommands = Number(process.env.GIT_HELP_MIN_COMMANDS || 200);
const maxRounds = Number(process.env.GIT_HELP_AYS_ROUNDS || 5);
const state = loadState();

async function callLlm(messages, { retries = 2 } = {}) {
  const estimatedTokens = Math.min(4000, estimateTokensFromMessages(messages) + 800);
  console.log(`llm call ~${estimatedTokens} tok…`);
  let lastErr;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await lim.schedule(() => llmJsonObject({ messages }), { estimatedTokens });
    } catch (err) {
      lastErr = err;
      if (err.code === 'RATE_LIMIT_PAUSE') throw err;
      console.error(`llm attempt ${i + 1} failed: ${err.message}`);
      if (i === retries) throw err;
    }
  }
  throw lastErr;
}

try {
  while (state.phase === 'extract' && state.pageIndex < pages.length) {
    const page = pages[state.pageIndex];
    const messages = [
      { role: 'system', content: EXTRACTOR_SYSTEM },
      {
        role: 'user',
        content: JSON.stringify({
          url: page.url,
          documentation_text: page.text,
          topic_checklist: TOPIC_CHECKLIST,
          glossary,
        }),
      },
    ];
    try {
      const out = await callLlm(messages);
      state.commands = mergeCommands(state.commands, out.commands || [], glossary);
    } catch (err) {
      if (err.code === 'RATE_LIMIT_PAUSE') throw err;
      console.error(`extract skip ${page.url}: ${err.message}`);
    }
    state.pageIndex += 1;
    saveState(state);
    const cov = critiqueCoverage(state.commands);
    console.log(JSON.stringify({
      phase: 'extract',
      url: page.url,
      pageIndex: state.pageIndex,
      count: state.commands.length,
      missingTopics: cov.missing.length,
    }));
    if (state.commands.length >= minCommands && cov.missing.length === 0) {
      console.log('Extract early-complete: min examples + all topics covered');
      state.phase = 'are_you_sure';
      saveState(state);
      break;
    }
    if (state.commands.length >= Math.max(minCommands, 280)) {
      console.log('Extract early-complete: example volume threshold');
      state.phase = 'are_you_sure';
      saveState(state);
      break;
    }
  }
  if (state.phase === 'extract') {
    state.phase = 'are_you_sure';
    saveState(state);
  }

  while (state.phase === 'are_you_sure' && state.aysRound < maxRounds) {
    state.aysRound += 1;
    const coverage = critiqueCoverage(state.commands);
    const messages = [
      { role: 'system', content: ARE_YOU_SURE_SYSTEM },
      {
        role: 'user',
        content: JSON.stringify({
          are_you_sure: true,
          question: 'Are you sure this git command catalog is complete for everyday developers?',
          min_examples: minCommands,
          current_count: state.commands.length,
          topic_checklist: TOPIC_CHECKLIST,
          coverage_missing_topics: coverage.missing,
          sample_examples: state.commands.slice(0, 100).map((c) => c.example),
          all_topics_present: [...new Set(state.commands.map((c) => c.topic))],
          glossary,
        }),
      },
    ];
    try {
      const audit = await callLlm(messages);
      const added = mergeCommands([], audit.additional_commands || [], glossary);
      state.commands = mergeCommands(state.commands, added, glossary);
      const after = critiqueCoverage(state.commands);
      const roundInfo = {
        round: state.aysRound,
        sure: Boolean(audit.sure),
        rationale: audit.rationale || '',
        added: added.length,
        count: state.commands.length,
        missing_topics: after.missing,
      };
      state.rounds.push(roundInfo);
      saveState(state);
      console.log(JSON.stringify({ phase: 'are_you_sure', ...roundInfo }));

      const complete = Boolean(audit.sure) && state.commands.length >= minCommands && after.missing.length === 0;
      const stalled = added.length === 0 && after.missing.length === 0 && state.commands.length >= minCommands;
      const coveredEnough = after.missing.length === 0 && state.commands.length >= minCommands && state.aysRound >= 2;
      if (complete || stalled || coveredEnough) {
        state.phase = 'done';
        state.sure = true;
        saveState(state);
        break;
      }
    } catch (err) {
      if (err.code === 'RATE_LIMIT_PAUSE') throw err;
      console.error(`are_you_sure round ${state.aysRound} failed: ${err.message}`);
      const after = critiqueCoverage(state.commands);
      if (after.missing.length === 0 && state.commands.length >= minCommands) {
        console.log('AYS parse fault but coverage OK — completing step1');
        state.phase = 'done';
        state.sure = true;
        saveState(state);
        break;
      }
    }
  }

  if (state.phase !== 'done') {
    state.phase = 'done';
    state.sure = critiqueCoverage(state.commands).complete;
    saveState(state);
  }

  const { commands, drops, allowlist } = normalizeCommands(state.commands, { glossary });
  writeFileSync(path.join(outDir, 'commands.raw.json'), `${JSON.stringify(state.commands, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'commands.grouped.json'), `${JSON.stringify(groupByCommand(commands), null, 2)}\n`);
  writeFileSync(path.join(outDir, 'commands.extracted.json'), `${JSON.stringify(commands, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'commands.json'), `${JSON.stringify(commands, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'command-allowlist.json'), `${JSON.stringify(allowlist, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'drops.step1.jsonl'), drops.map((d) => JSON.stringify(d)).join('\n') + (drops.length ? '\n' : ''));

  const manifest = {
    step: 1,
    source: `local-docs+${provider.id}-are-you-sure`,
    provider: provider.id,
    model: provider.defaultModel,
    exampleCount: commands.length,
    count: commands.length,
    sure: Boolean(state.sure),
    rounds: state.rounds,
    coverage: critiqueCoverage(commands),
    hash: createHash('sha256').update(JSON.stringify(commands)).digest('hex'),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(path.join(outDir, 'manifest.step1.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Step1 done: ${commands.length} examples, sure=${manifest.sure}`);
  console.log('Day usage', lim.getDayUsage());
} catch (e) {
  if (e.code === 'RATE_LIMIT_PAUSE') {
    console.error('Rate/quota pause — re-run bun run build-catalog:commands to resume');
    process.exit(20);
  }
  throw e;
}
