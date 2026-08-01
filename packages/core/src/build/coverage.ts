/**
 * Per-verb coverage metrics for multi-axis evolve loop.
 */
import { parseCommands } from '../db/recipeFormat.js';
import {
  LOOP_SATURATION_K,
  LOOP_FLAG_FINGERPRINT_FLOOR,
  LOOP_STATE_BUCKET_FLOOR,
  LOOP_MAX_RECIPE_STEPS,
} from '../db/constants.js';

export const MUTATION_KINDS = /** @type {const} */ (['state', 'flag', 'composition']);
export const STATE_BUCKETS = /** @type {const} */ ([
  'minimal',
  'dirty_worktree',
  'with_remote',
  'detached_or_diverged',
]);

/**
 * @param {string} commandLine e.g. `git rebase -i HEAD~3`
 * @returns {string} `git rebase`
 */
export function verbFromCommandLine(commandLine) {
  const parts = String(commandLine || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2 || parts[0] !== 'git') return '';
  return `git ${parts[1]}`;
}

/**
 * @param {object|string} recipe
 * @returns {string[]}
 */
export function verbsInRecipe(recipe) {
  const steps = parseCommands(recipe?.command_recipe ?? recipe);
  const set = new Set();
  for (const s of steps) {
    const v = verbFromCommandLine(s.command);
    if (v) set.add(v);
  }
  return [...set].sort();
}

/**
 * Normalized flag tokens from a command line (long and short).
 * @param {string} commandLine
 */
export function flagsFromCommandLine(commandLine) {
  const parts = String(commandLine || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const flags = new Set();
  for (let i = 2; i < parts.length; i += 1) {
    const p = parts[i];
    if (p.startsWith('--')) {
      flags.add(p.split('=')[0]);
    } else if (/^-[a-zA-Z]/.test(p) && p !== '-') {
      flags.add(p);
    }
  }
  return [...flags].sort();
}

/**
 * Fingerprint of flags used on steps matching verb.
 * @param {object|string} recipe
 * @param {string} verb e.g. `git rebase`
 */
export function flagFingerprintForVerb(recipe, verb) {
  const steps = parseCommands(recipe?.command_recipe ?? recipe);
  const flags = new Set();
  for (const s of steps) {
    if (verbFromCommandLine(s.command) !== verb) continue;
    for (const f of flagsFromCommandLine(s.command)) flags.add(f);
  }
  return [...flags].sort().join(' ');
}

/**
 * Parse flag tokens advertised in `git <cmd> -h` text.
 * @param {string} helpText
 */
export function parseFlagsFromHelp(helpText) {
  const flags = new Set();
  const text = String(helpText || '');
  for (const m of text.matchAll(/--[a-z0-9][a-z0-9-]*/gi)) {
    flags.add(m[0].toLowerCase());
  }
  for (const m of text.matchAll(/(?:^|[\s,|\[(])(-[a-zA-Z])(?=[\s,|\])]|$|=)/gm)) {
    flags.add(m[1]);
  }
  return flags;
}

/**
 * @param {string} initialState
 * @returns {(typeof STATE_BUCKETS)[number]}
 */
export function stateBucket(initialState) {
  const s = String(initialState || '').toLowerCase();
  if (
    /detach|detached|checkout\s+[0-9a-f]{7,}|reset\s+--hard\s+head~\d+|branch.*diverg|merge-base/.test(
      s,
    )
  ) {
    return 'detached_or_diverged';
  }
  if (/remote|git_grasp_remotes|git\s+remote\s+add|fetch\s+origin/.test(s)) {
    return 'with_remote';
  }
  if (
    /echo\s+.*>|printf\s+|dirty|untracked|git\s+add|working tree|modify/.test(s) &&
    !/commit\s+--allow-empty/.test(s)
  ) {
    // file writes / add without only empty commit scaffolding
    if (/echo\s+|printf\s+|>>|>\s+\w+|git\s+add/.test(s)) return 'dirty_worktree';
  }
  if (/echo\s+|printf\s+|>>|\btouch\b/.test(s)) return 'dirty_worktree';
  return 'minimal';
}

/**
 * Progress 0..1 for an axis (higher = more saturated).
 */
function axisProgress(cov) {
  const stateP = Math.min(1, cov.stateBuckets.size / LOOP_STATE_BUCKET_FLOOR);
  const flagP = Math.min(1, cov.flagFingerprints.size / LOOP_FLAG_FINGERPRINT_FLOOR);
  const len1 = cov.lengthHist[1] || 0;
  const len23 = (cov.lengthHist[2] || 0) + (cov.lengthHist[3] || 0);
  const len47 =
    (cov.lengthHist[4] || 0) +
    (cov.lengthHist[5] || 0) +
    (cov.lengthHist[6] || 0) +
    (cov.lengthHist[7] || 0);
  const compNeed = 1 + 3 + 2;
  const compHave =
    Math.min(1, len1) + Math.min(3, len23) + Math.min(2, len47);
  const compP = Math.min(1, compHave / compNeed);
  const countP = Math.min(1, cov.count / LOOP_SATURATION_K);
  return { state: stateP, flag: flagP, composition: compP, count: countP };
}

/**
 * @param {{ state: number, flag: number, composition: number }} progress
 * @param {{ compositionExhausted?: boolean }} [opts]
 * @returns {'state'|'flag'|'composition'}
 */
export function weakestAxis(progress, opts = {}) {
  /** @type {{ kind: 'state'|'flag'|'composition', p: number }[]} */
  const axes = [
    { kind: 'state', p: progress.state },
    { kind: 'flag', p: progress.flag },
    { kind: 'composition', p: progress.composition },
  ];
  if (opts.compositionExhausted) {
    axes[2].p = 1; // treat as done so it won't be picked
  }
  axes.sort((a, b) => a.p - b.p || MUTATION_KINDS.indexOf(a.kind) - MUTATION_KINDS.indexOf(b.kind));
  return axes[0].kind;
}

/**
 * @param {object[]} rows command rows
 * @param {{ k?: number }} [opts]
 */
export function buildVerbCoverage(rows, opts = {}) {
  const k = opts.k ?? LOOP_SATURATION_K;
  /** @type {Map<string, { count: number, rowIds: Set<number>, stateBuckets: Set<string>, flagFingerprints: Set<string>, lengthHist: Record<number, number> }>} */
  const map = new Map();

  const ensure = (verb) => {
    if (!map.has(verb)) {
      map.set(verb, {
        count: 0,
        rowIds: new Set(),
        stateBuckets: new Set(),
        flagFingerprints: new Set(),
        lengthHist: {},
      });
    }
    return map.get(verb);
  };

  for (const row of rows) {
    const steps = parseCommands(row.command_recipe);
    // Saturation counts primary verb only (first step).
    const primaryVerb = verbFromCommandLine(steps[0]?.command || '');
    if (!primaryVerb) continue;
    const verbs = [primaryVerb];
    const bucket = stateBucket(row.initial_state);
    const len = Math.min(LOOP_MAX_RECIPE_STEPS, Math.max(1, steps.length));
    for (const verb of verbs) {
      const cov = ensure(verb);
      if (!cov.rowIds.has(row.row_id)) {
        cov.rowIds.add(row.row_id);
        cov.count += 1;
      }
      cov.stateBuckets.add(bucket);
      const fp = flagFingerprintForVerb(row, verb);
      if (fp) cov.flagFingerprints.add(fp);
      else cov.flagFingerprints.add('(none)');
      cov.lengthHist[len] = (cov.lengthHist[len] || 0) + 1;
    }
  }

  /** @type {Record<string, object>} */
  const out = {};
  for (const [verb, cov] of map.entries()) {
    const progress = axisProgress(cov);
    const floorsMet =
      cov.stateBuckets.size >= LOOP_STATE_BUCKET_FLOOR &&
      cov.flagFingerprints.size >= LOOP_FLAG_FINGERPRINT_FLOOR &&
      (cov.lengthHist[1] || 0) >= 1 &&
      (cov.lengthHist[2] || 0) + (cov.lengthHist[3] || 0) >= 3 &&
      (cov.lengthHist[4] || 0) +
        (cov.lengthHist[5] || 0) +
        (cov.lengthHist[6] || 0) +
        (cov.lengthHist[7] || 0) >=
        2;
    const saturated = cov.count >= k && floorsMet;
    out[verb] = {
      verb,
      count: cov.count,
      stateBuckets: [...cov.stateBuckets],
      flagFingerprints: [...cov.flagFingerprints],
      lengthHist: { ...cov.lengthHist },
      progress,
      saturated,
      weakestAxis: weakestAxis(progress),
      saturationScore: (progress.count + progress.state + progress.flag + progress.composition) / 4,
    };
  }
  return out;
}

/**
 * @param {Record<string, { saturated: boolean }>} coverage
 * @param {string[]} taxonomyVerbs
 */
export function allVerbsSaturated(coverage, taxonomyVerbs) {
  if (!taxonomyVerbs?.length) return false;
  return taxonomyVerbs.every((v) => coverage[v]?.saturated);
}

/**
 * Undersampling score for a leaf (lower = more urgent).
 * @param {object} row
 * @param {Record<string, { saturationScore: number, weakestAxis: string }>} coverage
 */
export function leafPriorityScore(row, coverage) {
  const verbs = verbsInRecipe(row);
  if (!verbs.length) return 0;
  let min = Infinity;
  for (const v of verbs) {
    const s = coverage[v]?.saturationScore ?? 0;
    if (s < min) min = s;
  }
  return min;
}

/**
 * Pick mutation kind for a leaf given coverage.
 * @param {object} row
 * @param {Record<string, { progress: object, weakestAxis: string }>} coverage
 */
export function assignMutationKind(row, coverage) {
  const steps = parseCommands(row.command_recipe);
  const compositionExhausted = steps.length >= LOOP_MAX_RECIPE_STEPS;
  const verbs = verbsInRecipe(row);
  if (!verbs.length) {
    return compositionExhausted ? 'state' : 'composition';
  }
  // Aggregate progress: take min per axis across verbs (weakest overall)
  const agg = { state: 1, flag: 1, composition: 1 };
  for (const v of verbs) {
    const p = coverage[v]?.progress || { state: 0, flag: 0, composition: 0 };
    agg.state = Math.min(agg.state, p.state);
    agg.flag = Math.min(agg.flag, p.flag);
    agg.composition = Math.min(agg.composition, p.composition);
  }
  return weakestAxis(agg, { compositionExhausted });
}

/**
 * @param {string} commandLine
 * @param {Set<string>|string[]} allowlist
 */
export function flagsAllowedOnCommand(commandLine, allowlist) {
  const allow = allowlist instanceof Set ? allowlist : new Set(allowlist || []);
  if (!allow.size) return true; // empty allowlist = skip strict check when help missing
  const used = flagsFromCommandLine(commandLine);
  return used.every((f) => allow.has(f) || allow.has(f.toLowerCase()));
}

/**
 * Verbs of each step in order.
 * @param {object|string} recipe
 */
export function stepVerbs(recipe) {
  return parseCommands(recipe?.command_recipe ?? recipe).map((s) =>
    verbFromCommandLine(s.command),
  );
}

/**
 * True if step verbs are identical (Flag/State invariant).
 */
export function sameStepVerbs(a, b) {
  const va = stepVerbs(a);
  const vb = stepVerbs(b);
  if (va.length !== vb.length) return false;
  return va.every((v, i) => v === vb[i]);
}
