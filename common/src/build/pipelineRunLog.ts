// @ts-nocheck
/**
 * Structured artifacts for one build:loop / ground run under local/build-pipeline/.
 */
import {
  mkdirSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  cpSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { buildPipelineRunsDir } from '../lib/paths.js';

/**
 * @param {Date|string|number} [startedAt]
 */
export function formatRunTimestamp(startedAt = new Date()) {
  const d = startedAt instanceof Date ? startedAt : new Date(startedAt);
  return d.toISOString().replace(/[:.]/g, '-');
}

/**
 * @param {{ startedAt?: Date, runDir?: string }} [opts]
 */
export function createBuildPipelineRunDir(opts = {}) {
  const startedAt = opts.startedAt || new Date();
  const ts = formatRunTimestamp(startedAt);
  const runDir = opts.runDir || path.join(buildPipelineRunsDir(), `run_${ts}`);
  mkdirSync(path.join(runDir, 'phases'), { recursive: true });
  return { runDir, startedAt, ts };
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function slimEvalResult(evalResult) {
  if (!evalResult || evalResult.skipped) {
    return { skipped: true, ...(evalResult || {}) };
  }
  const misses = (evalResult.results || []).filter((r) => r && r.pass !== true);
  return {
    ok: evalResult.ok,
    okHit: evalResult.okHit,
    okPass: evalResult.okPass,
    passed: evalResult.passed,
    hitPassed: evalResult.hitPassed,
    judgePassed: evalResult.judgePassed,
    total: evalResult.total,
    rate: evalResult.rate,
    hitRate: evalResult.hitRate,
    verbRate: evalResult.verbRate,
    minPassRate: evalResult.minPassRate,
    minHitAtDisplayRate: evalResult.minHitAtDisplayRate,
    byMutationKind: evalResult.byMutationKind,
    judgeSummary: evalResult.judgeSummary,
    skippedJudge: evalResult.skippedJudge,
    timing: evalResult.timing,
    missCount: misses.length,
    misses: misses.map((m) => ({
      query_text: m?.query?.query_text,
      command_id: m?.query?.command_id,
      primary_verb: m?.query?.primary_verb,
      mutation_kind: m?.query?.mutation_kind,
      via: m?.via,
      utility: m?.utility ?? m?.judge?.utility,
      reason: m?.reason ?? m?.judge?.reason,
      displayed: (m?.displayed || []).map((h) => ({
        command_id: h.command_id ?? h.recipe_id,
        example: h.example,
        snippet: h.snippet,
      })),
    })),
  };
}

/**
 * Create a run logger: config, console tee, phase eval dumps, summary.
 * @param {{
 *   runDir: string,
 *   startedAt: Date,
 *   config: object,
 * }} opts
 */
export function createPipelineRunLogger(opts) {
  const { runDir, startedAt, config } = opts;
  mkdirSync(runDir, { recursive: true });
  const consolePath = path.join(runDir, 'console.log');
  const eventsPath = path.join(runDir, 'events.jsonl');
  writeJson(path.join(runDir, 'config.json'), {
    startedAt: startedAt.toISOString(),
    ...config,
  });
  writeFileSync(consolePath, '', 'utf8');

  const phases = [];

  function appendConsole(line) {
    appendFileSync(consolePath, `${line}\n`, 'utf8');
  }

  function emit(event) {
    const row = { ts: new Date().toISOString(), ...event };
    appendFileSync(eventsPath, `${JSON.stringify(row)}\n`, 'utf8');
    return row;
  }

  function logLine(...args) {
    const text = args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    appendConsole(text);
  }

  /**
   * Hook for orchestrator build log lines (already prefixed).
   */
  function onBuildLog(line) {
    appendConsole(String(line));
  }

  function phaseDir(meta) {
    if (meta.phase === 'ground') {
      return path.join(runDir, 'phases', 'ground');
    }
    if (meta.phase === 'loop') {
      const iter = String(meta.iteration ?? 0).padStart(3, '0');
      return path.join(runDir, 'phases', 'loop', `iter-${iter}`);
    }
    return path.join(runDir, 'phases', String(meta.phase || 'unknown'));
  }

  function onEvalReport(evalResult, meta = {}) {
    const dir = phaseDir(meta);
    mkdirSync(dir, { recursive: true });
    const slim = slimEvalResult(evalResult);
    writeJson(path.join(dir, 'eval-report.json'), slim);
    if (evalResult?.results) {
      writeJson(path.join(dir, 'eval-results.json'), evalResult.results);
    }
    if (meta.improve) {
      const improveDir = path.join(dir, 'improve');
      mkdirSync(improveDir, { recursive: true });
      writeJson(path.join(improveDir, 'improve-result.json'), {
        ran: meta.improve.ran,
        accepted: meta.improve.accepted,
        reason: meta.improve.reason,
        errors: meta.improve.errors,
        proposals: meta.improve.proposals,
        artifactsDir: meta.improve.artifactsDir,
      });
      if (meta.improve.artifactsDir && existsSync(meta.improve.artifactsDir)) {
        const dest = path.join(improveDir, 'proposal-round');
        const src = path.resolve(meta.improve.artifactsDir);
        if (src !== path.resolve(dest)) {
          try {
            cpSync(src, dest, { recursive: true });
          } catch {
            // best-effort
          }
        }
      }
    }
    const entry = {
      phase: meta.phase,
      iteration: meta.iteration ?? null,
      ok: slim.ok,
      rate: slim.rate,
      hitRate: slim.hitRate,
      missCount: slim.missCount,
      improveReason: meta.improve?.reason ?? null,
      improveAccepted: meta.improve?.accepted ?? null,
      dir: path.relative(runDir, dir),
    };
    phases.push(entry);
    emit({ type: 'eval_report', ...entry });
  }

  function improveArtifactsDir(meta) {
    return path.join(phaseDir(meta), 'improve', 'proposal-round');
  }

  function finalize(result) {
    const endedAt = new Date();
    const summary = {
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      elapsedMs: endedAt - startedAt,
      ok: !!result?.ok,
      phase: result?.phase ?? null,
      iteration: result?.iteration ?? null,
      message: result?.message ?? null,
      phases,
      result: sanitizeResult(result),
    };
    writeJson(path.join(runDir, 'summary.json'), summary);
    emit({ type: 'finalize', ok: summary.ok, phase: summary.phase, elapsedMs: summary.elapsedMs });
    // Latest pointer for convenience
    try {
      writeJson(path.join(path.dirname(runDir), 'latest.json'), {
        runDir,
        endedAt: endedAt.toISOString(),
        ok: summary.ok,
      });
    } catch {
      // ignore
    }
    return summary;
  }

  return {
    runDir,
    consolePath,
    logLine,
    onBuildLog,
    onEvalReport,
    improveArtifactsDir,
    emit,
    finalize,
  };
}

function sanitizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  const out = { ...result };
  if (out.eval) out.eval = slimEvalResult(out.eval);
  if (out.ko) out.ko = slimEvalResult(out.ko);
  if (out.ground?.eval) {
    out.ground = { ...out.ground, eval: slimEvalResult(out.ground.eval) };
  }
  // Drop huge nested blobs if present
  delete out.groups;
  return out;
}

/** List run dirs newest-first (test helper). */
export function listBuildPipelineRuns(root) {
  const base = root || buildPipelineRunsDir();
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((n) => n.startsWith('run_'))
    .sort()
    .reverse()
    .map((n) => path.join(base, n));
}
