#!/usr/bin/env bun
/**
 * CLI latency bench for the perf budget gate.
 *
 * Measures full Bun CLI wall time (cold + warm) against bench/queries.json.
 *
 * Usage:
 *   bun run bench
 *   bun run bench -- --mode warm --skill both --iters 50 --discard 5
 *   bun run bench -- --json --out bench/results.json
 *   bun run bench -- --synthetic
 *   bun run bench -- --quick   # 2 discard, 5 iters (smoke)
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACKAGE_ROOT,
  openDb,
  loadAllRows,
  knnRecall,
  getEmbedder,
  rankResults,
  loadThresholds,
  defaultDbPath,
  search,
  writeConfig,
  readConfig,
  DEFAULT_RECALL_K,
} from '@git-help/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = PACKAGE_ROOT;
const CLI = path.join(ROOT, 'apps', 'cli', 'bin', 'index.js');
const COMPILED_BASE = path.join(ROOT, 'bench', 'git-help');
const QUERIES_PATH = path.join(ROOT, 'bench', 'queries.json');
const BUDGET_MS = 500;

function compiledPath() {
  const exe = `${COMPILED_BASE}.exe`;
  if (process.platform === 'win32') {
    if (existsSync(exe)) return exe;
    if (existsSync(COMPILED_BASE)) return COMPILED_BASE;
    return exe;
  }
  return COMPILED_BASE;
}

function resolveCliInvoker(preferCompile) {
  if (preferCompile) {
    const compiled = compiledPath();
    if (existsSync(compiled)) {
      return { cmd: compiled, args: [], label: 'compiled' };
    }
  }
  return { cmd: 'bun', args: [CLI], label: 'bun-script' };
}

function ensureCompiled() {
  const out = compiledPath();
  if (existsSync(out)) return out;
  mkdirSync(path.dirname(out), { recursive: true });
  const outfile = process.platform === 'win32' ? `${COMPILED_BASE}.exe` : COMPILED_BASE;
  console.error(`Compiling CLI → ${outfile}`);
  const r = spawnSync('bun', ['build', '--compile', CLI, '--outfile', outfile], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('bun build --compile failed');
  return outfile;
}

function parseArgs(argv) {
  const out = {
    mode: 'both', // cold | warm | both
    skill: 'both', // default | 2 | both
    discard: 5,
    iters: 50,
    json: false,
    out: null,
    synthetic: false,
    quick: false,
    queryLimit: null,
    mock: process.env.GIT_HELP_MOCK_EMBEDDINGS === '1',
    // bun --compile + sharp/transformers is reliable on Linux (Docker gate).
    // Windows defaults to bun-script unless --compile is forced.
    compile: process.env.GIT_HELP_BENCH_COMPILE === '1'
      || (process.platform !== 'win32' && process.env.GIT_HELP_BENCH_COMPILE !== '0'),
    noCompile: false,
    sticky: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mode') out.mode = argv[++i];
    else if (a === '--skill') out.skill = argv[++i];
    else if (a === '--discard') out.discard = Number(argv[++i]);
    else if (a === '--iters') out.iters = Number(argv[++i]);
    else if (a === '--json') out.json = true;
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--synthetic') out.synthetic = true;
    else if (a === '--quick') out.quick = true;
    else if (a === '--limit') out.queryLimit = Number(argv[++i]);
    else if (a === '--mock') out.mock = true;
    else if (a === '--compile') out.compile = true;
    else if (a === '--no-compile') out.noCompile = true;
    else if (a === '--sticky') out.sticky = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: bun scripts/bench-search.js [options]
  --mode cold|warm|both   (default both)
  --skill default|2|both  (default both)
  --discard N             warm discards (default 5)
  --iters N               timed samples (default 50)
  --limit N               cap queries
  --quick                 discard=2 iters=5
  --synthetic             intent 3 vs 5 projection (in-process)
  --sticky                also report in-process sticky-warm (model stays loaded)
  --compile               use bun --compile binary (Linux default)
  --no-compile            bench bun script entry instead
  --mock                  GIT_HELP_MOCK_EMBEDDINGS=1
  --json --out path       write JSON report`);
      process.exit(0);
    }
  }
  if (out.quick) {
    out.discard = 2;
    out.iters = 5;
  }
  if (out.noCompile) out.compile = false;
  return out;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    mean: sorted.length ? sum / sorted.length : null,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
  };
}

function runCli(query, env = {}, invoker) {
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn(invoker.cmd, [...invoker.args, query], {
      cwd: ROOT,
      env: { ...process.env, ...env, GIT_HELP_MOCK_EMBEDDINGS: env.GIT_HELP_MOCK_EMBEDDINGS ?? process.env.GIT_HELP_MOCK_EMBEDDINGS },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      resolve({
        ms: performance.now() - start,
        code: code ?? 1,
        stderr,
      });
    });
  });
}

/**
 * Sticky warm: one process, model stays in RAM; queries via repeated `search()` calls.
 * Diagnoses search-path latency without per-process MiniLM reload (product CLI is still process-per-call).
 */
async function benchStickyWarm({ queries, iters, discard, mock, skillLevel }) {
  if (mock) process.env.GIT_HELP_MOCK_EMBEDDINGS = '1';
  process.env.GIT_HELP_BENCH = '1';
  // Warm model + first search
  for (let i = 0; i < discard; i += 1) {
    await search(queries[i % queries.length].query, {
      forceMockEmbeddings: mock,
      skillLevelOverride: skillLevel,
    });
  }
  const samples = [];
  for (let i = 0; i < iters; i += 1) {
    const q = queries[i % queries.length].query;
    const t0 = performance.now();
    await search(q, { forceMockEmbeddings: mock, skillLevelOverride: skillLevel });
    samples.push(performance.now() - t0);
  }
  return summarize(samples);
}

function setSkill(level) {
  const prev = readConfig();
  writeConfig({ skillLevel: level });
  return prev.skillLevel;
}

function loadQueries(limit) {
  const data = JSON.parse(readFileSync(QUERIES_PATH, 'utf8'));
  let list = data.queries || [];
  if (limit != null) list = list.slice(0, limit);
  return { provenance: data.provenance, queries: list };
}

async function benchCliMode({ mode, queries, iters, discard, mock, invoker }) {
  const env = mock ? { GIT_HELP_MOCK_EMBEDDINGS: '1' } : {};
  const samples = [];
  const cycle = [];
  for (let i = 0; i < queries.length; i += 1) {
    cycle.push(queries[i].query);
  }
  if (cycle.length === 0) throw new Error('No queries');

  const totalRuns = mode === 'cold' ? iters : discard + iters;
  for (let i = 0; i < totalRuns; i += 1) {
    const q = cycle[i % cycle.length];
    const r = await runCli(q, env, invoker);
    if (r.code !== 0) {
      console.error(`CLI failed (code=${r.code}) for: ${q}\n${r.stderr.slice(0, 400)}`);
      if (r.code !== 4) {
        throw new Error(`Bench aborted: CLI exit ${r.code} for query: ${q}`);
      }
    }
    if (mode === 'cold') {
      samples.push(r.ms);
    } else if (i >= discard) {
      samples.push(r.ms);
    }
  }
  return summarize(samples);
}

async function runSynthetic() {
  const db = openDb(defaultDbPath(), { readonly: true });
  let rows;
  try {
    rows = loadAllRows(db);
  } finally {
    db.close();
  }
  const n = rows.length;
  const examples = new Set(rows.map((r) => r.example || r.command)).size;
  const skills = new Set(rows.map((r) => r.skill_level)).size || 4;
  const intentsPer = n / Math.max(1, examples * skills);

  const embedder = await getEmbedder({
    forceMock: process.env.GIT_HELP_MOCK_EMBEDDINGS === '1',
  });
  const thresholds = loadThresholds();
  const query = 'undo last commit keep changes';
  const embedding = await embedder.embed(query);

  const db2 = openDb(defaultDbPath(), { readonly: true });
  let baseCandidates;
  try {
    baseCandidates = knnRecall(db2, embedding, Math.max(DEFAULT_RECALL_K, 50));
  } finally {
    db2.close();
  }

  function timeRank(factor, label) {
    const target = Math.max(1, Math.round(baseCandidates.length * factor));
    const synth = [];
    for (let i = 0; i < target; i += 1) {
      const src = baseCandidates[i % baseCandidates.length];
      synth.push({ ...src, id: `${src.id}__syn${i}` });
    }
    const times = [];
    for (let i = 0; i < 30; i += 1) {
      const t0 = performance.now();
      rankResults(synth, embedding, thresholds, { skillLevel: null });
      times.push(performance.now() - t0);
    }
    return { label, factor, candidateN: synth.length, ...summarize(times) };
  }

  // Relative to ~current intent density: scale candidates as if intents were 3 vs 5
  const f3 = 3 / Math.max(intentsPer, 0.5);
  const f5 = 5 / Math.max(intentsPer, 0.5);

  return {
    kind: 'synthetic-intent-cardinality',
    note: 'In-process rank() on duplicated KNN candidates — latency projection only, not quality',
    catalog: { rows: n, examples, skills, intentsPerSkillExample: intentsPer },
    projectedRows: {
      intents3: Math.round(examples * skills * 3),
      intents5: Math.round(examples * skills * 5),
    },
    rank: {
      baseline: timeRank(1, 'baseline'),
      intents3: timeRank(f3, 'intents≈3'),
      intents5: timeRank(f5, 'intents≈5'),
    },
  };
}

async function sampleBreakdown(query, mock) {
  process.env.GIT_HELP_BENCH = '1';
  if (mock) process.env.GIT_HELP_MOCK_EMBEDDINGS = '1';
  const result = await search(query, { forceMockEmbeddings: mock });
  return result._bench || null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(QUERIES_PATH)) {
    console.error(`Missing ${QUERIES_PATH}`);
    process.exit(1);
  }
  if (!existsSync(CLI)) {
    console.error(`Missing CLI at ${CLI}`);
    process.exit(1);
  }

  const { provenance, queries } = loadQueries(opts.queryLimit);
  const skills = opts.skill === 'both' ? ['default', '2'] : [opts.skill];
  const modes = opts.mode === 'both' ? ['cold', 'warm'] : [opts.mode];

  if (opts.compile) ensureCompiled();
  const invoker = resolveCliInvoker(opts.compile);

  const report = {
    at: new Date().toISOString(),
    budgetMs: BUDGET_MS,
    runtime: typeof Bun !== 'undefined' ? `bun ${Bun.version}` : 'unknown',
    invoker: invoker.label,
    provenance,
    queryCount: queries.length,
    protocol: {
      discard: opts.discard,
      iters: opts.iters,
      mock: opts.mock,
      compile: opts.compile,
      note: 'Each sample is a fresh CLI process. Default invoker is bun --compile binary (faster startup). Cold=timed from first samples; warm=after discard (disk caches hot).',
    },
    results: [],
    breakdown: null,
    synthetic: null,
    gate: null,
  };

  const prevSkill = readConfig().skillLevel;

  try {
    if (opts.synthetic) {
      report.synthetic = await runSynthetic();
    }

    for (const skill of skills) {
      const level = skill === 'default' || skill === 'off' ? null : Number(skill);
      setSkill(level);

      for (const mode of modes) {
        console.error(`bench: mode=${mode} skill=${skill} invoker=${invoker.label} discard=${opts.discard} iters=${opts.iters} queries=${queries.length}`);
        const stats = await benchCliMode({
          mode,
          queries,
          iters: opts.iters,
          discard: opts.discard,
          mock: opts.mock,
          invoker,
        });
        const pass = stats.p95 != null && stats.p95 < BUDGET_MS;
        report.results.push({
          mode,
          skill,
          skillLevel: level,
          ...stats,
          pass,
          budgetMs: BUDGET_MS,
        });
        console.error(
          `  p50=${stats.p50?.toFixed(1)}ms p95=${stats.p95?.toFixed(1)}ms mean=${stats.mean?.toFixed(1)}ms ${pass ? 'PASS' : 'FAIL'}`,
        );
      }

      if (opts.sticky) {
        console.error(`bench: mode=sticky-warm skill=${skill} (in-process, model resident)`);
        const sticky = await benchStickyWarm({
          queries,
          iters: opts.iters,
          discard: opts.discard,
          mock: opts.mock,
          skillLevel: level,
        });
        const pass = sticky.p95 != null && sticky.p95 < BUDGET_MS;
        report.results.push({
          mode: 'sticky-warm',
          skill,
          skillLevel: level,
          ...sticky,
          pass,
          budgetMs: BUDGET_MS,
        });
        console.error(
          `  p50=${sticky.p50?.toFixed(1)}ms p95=${sticky.p95?.toFixed(1)}ms mean=${sticky.mean?.toFixed(1)}ms ${pass ? 'PASS' : 'FAIL'}`,
        );
      }
    }

    // One in-process breakdown (skill off)
    setSkill(null);
    report.breakdown = await sampleBreakdown(queries[0].query, opts.mock);

    const gateRows = report.results.filter((r) => r.mode === 'warm' || r.mode === 'cold');
    report.gate = {
      budgetMs: BUDGET_MS,
      allPass: gateRows.every((r) => r.pass),
      failing: gateRows.filter((r) => !r.pass).map((r) => `${r.mode}/${r.skill} p95=${r.p95?.toFixed(1)}`),
    };
  } finally {
    writeConfig({ skillLevel: prevSkill ?? null });
  }

  const text = formatTable(report);
  console.log(text);

  if (opts.json || opts.out) {
    const payload = JSON.stringify(report, null, 2);
    if (opts.out) {
      mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
      writeFileSync(opts.out, `${payload}\n`);
      console.error(`Wrote ${opts.out}`);
    } else {
      console.log(payload);
    }
  }

  process.exitCode = report.gate?.allPass ? 0 : 1;
}

function formatTable(report) {
  const lines = [];
  lines.push('# git-help search latency');
  lines.push(`budget: p95 < ${report.budgetMs}ms | queries: ${report.queryCount} | ${report.runtime}`);
  lines.push('');
  lines.push('| mode | skill | n | p50 (ms) | p95 (ms) | mean (ms) | gate |');
  lines.push('|------|-------|---|----------|----------|-----------|------|');
  for (const r of report.results) {
    lines.push(
      `| ${r.mode} | ${r.skill} | ${r.n} | ${r.p50?.toFixed(1)} | ${r.p95?.toFixed(1)} | ${r.mean?.toFixed(1)} | ${r.pass ? 'PASS' : 'FAIL'} |`,
    );
  }
  if (report.breakdown) {
    lines.push('');
    lines.push('## In-process breakdown (one search)');
    const { total, phases } = report.breakdown;
    lines.push(`total=${total.toFixed(1)}ms`);
    for (const [k, v] of Object.entries(phases)) {
      lines.push(`- ${k}: ${Number(v).toFixed(1)}ms`);
    }
  }
  if (report.synthetic) {
    const s = report.synthetic;
    lines.push('');
    lines.push('## Synthetic intent cardinality (rank only)');
    lines.push(`catalog rows=${s.catalog.rows} examples=${s.catalog.examples} intents≈${s.catalog.intentsPerSkillExample.toFixed(2)}`);
    lines.push(`projected rows intents3=${s.projectedRows.intents3} intents5=${s.projectedRows.intents5}`);
    for (const key of ['baseline', 'intents3', 'intents5']) {
      const r = s.rank[key];
      lines.push(`- ${r.label}: candidates=${r.candidateN} p50=${r.p50?.toFixed(2)}ms p95=${r.p95?.toFixed(2)}ms`);
    }
  }
  lines.push('');
  lines.push(`Gate: ${report.gate?.allPass ? 'PASS' : 'FAIL'} ${report.gate?.failing?.join(', ') || ''}`);
  return lines.join('\n');
}

await main();
