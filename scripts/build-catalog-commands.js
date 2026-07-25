#!/usr/bin/env node
/**
 * Step 1: Local docs → LLM extract → Are You Sure? loops.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PACKAGE_ROOT } from '../src/lib/paths.js';
import { loadEnv, requireLlmKey } from '../src/lib/env.js';
import { llmJsonObject } from '../src/lib/llm.js';
import { createRateLimiter, estimateTokensFromMessages } from '../src/lib/rateLimit.js';
import { getProvider } from '../src/lib/providers.js';
import { loadLocalDocs } from '../src/catalog/downloadDocs.js';
import { mergeCommands } from '../src/catalog/step1Commands.js';
import { TOPIC_CHECKLIST, critiqueCoverage } from '../src/catalog/critique.js';
import { normalizeCommands } from '../src/catalog/step3Normalize.js';

loadEnv();
requireLlmKey();

const EXTRACTOR_SYSTEM = `You are the git-help catalog EXTRACTOR.
Read git documentation text and list concrete git command examples.
Return JSON only:
{"commands":[{"command":"git status","topic":"status","risk_class":"none","source_hint":"note"}]}
Rules: command starts with git; no shell operators; placeholders ok; topic from checklist; risk_class none|low|high|destructive.`;

const ARE_YOU_SURE_SYSTEM = `You audit a git command catalog ("Are you sure?" reinforcement).
Return JSON only:
{"sure":false,"missing_topics":[],"additional_commands":[{"command":"git reset --soft HEAD~1","topic":"undo","risk_class":"high","source_hint":"gap"}],"rationale":"short"}
If sure=true, additional_commands must be []. Never invent non-git or shell pipelines.
When sure=false, propose at most 40 distinct additional_commands to fill gaps. Keep the JSON compact.`;

const outDir = path.join(PACKAGE_ROOT, 'data', 'catalog');
const localDir = path.join(PACKAGE_ROOT, 'local', 'catalog');
mkdirSync(outDir, { recursive: true });
mkdirSync(localDir, { recursive: true });

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
      { role: 'user', content: JSON.stringify({ url: page.url, documentation_text: page.text, topic_checklist: TOPIC_CHECKLIST }) },
    ];
    try {
      const out = await callLlm(messages);
      state.commands = mergeCommands(state.commands, out.commands || []);
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
      console.log('Extract early-complete: min commands + all topics covered');
      state.phase = 'are_you_sure';
      saveState(state);
      break;
    }
    if (state.commands.length >= Math.max(minCommands, 280)) {
      console.log('Extract early-complete: command volume threshold');
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
          min_commands: minCommands,
          current_count: state.commands.length,
          topic_checklist: TOPIC_CHECKLIST,
          coverage_missing_topics: coverage.missing,
          sample_commands: state.commands.slice(0, 100).map((c) => c.command),
          all_topics_present: [...new Set(state.commands.map((c) => c.topic))],
        }),
      },
    ];
    try {
      const audit = await callLlm(messages);
      const added = mergeCommands([], audit.additional_commands || []);
      state.commands = mergeCommands(state.commands, added);
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

  const { commands, drops, allowlist } = normalizeCommands(state.commands);
  writeFileSync(path.join(outDir, 'commands.raw.json'), `${JSON.stringify(state.commands, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'commands.extracted.json'), `${JSON.stringify(commands, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'commands.json'), `${JSON.stringify(commands, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'command-allowlist.json'), `${JSON.stringify(allowlist, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'drops.step1.jsonl'), drops.map((d) => JSON.stringify(d)).join('\n') + (drops.length ? '\n' : ''));

  const manifest = {
    step: 1,
    source: `local-docs+${provider.id}-are-you-sure`,
    provider: provider.id,
    model: provider.defaultModel,
    count: commands.length,
    sure: Boolean(state.sure),
    rounds: state.rounds,
    coverage: critiqueCoverage(commands),
    hash: createHash('sha256').update(JSON.stringify(commands)).digest('hex'),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(path.join(outDir, 'manifest.step1.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Step1 done: ${commands.length} commands, sure=${manifest.sure}`);
  console.log('Day usage', lim.getDayUsage());
} catch (e) {
  if (e.code === 'RATE_LIMIT_PAUSE') {
    console.error('Rate/quota pause — re-run npm run build-catalog:commands to resume');
    process.exit(20);
  }
  throw e;
}
