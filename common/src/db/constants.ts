// @ts-nocheck
/**
 * Shared numeric / string constants for catalog build, search, and eval.
 *
 * Finetuning map
 * --------------
 * Open this file to change **defaults**. Many build-gate / loop knobs can also
 * be overridden per run without editing code:
 *
 *   bun apps/pipeline/src/build-loop.ts --help
 *
 * Prefer CLI overrides for one-off experiments; change values here when the
 * new default should stick for all runs and docs.
 *
 * Sections below are ordered roughly by pipeline stage:
 * schema → search → hard caps → sandbox → evolve → intents → eval gates →
 * resume meta → eval parallelism / progress.
 */

// ---------------------------------------------------------------------------
// Schema & embedding (rarely touched)
// ---------------------------------------------------------------------------

/** Catalog / staging SQLite schema version. Bump only with a deliberate migration. */
export const SCHEMA_VERSION = 8;

/**
 * Embedding width (bge-small-en-v1.5 / prior MiniLM). Must match the loaded
 * model and `vec_*` table dims. Changing this requires a schema+catalog rebuild.
 */
export const EMBEDDING_DIM = 384;

/**
 * Hybrid search algorithm version stamped into CLI/web packs.
 * Bump when fusion / display semantics change so clients can detect mismatch.
 */
export const SEARCH_ALGORITHM_VERSION = 2;

/**
 * Additive hybrid score bump when query names the hit's primary verb.
 */
export const PRIMARY_VERB_BOOST = 0.25;

/**
 * Extra hybrid score bump per query-named verb covered by a multi-step recipe
 * (beyond the primary). Caps with PRIMARY_VERB_BOOST at 1.0 total score.
 */
export const VERB_COVERAGE_BOOST_PER = 0.12;

// ---------------------------------------------------------------------------
// Display gate (fusion.ts displayCountFromConfidence)
// ---------------------------------------------------------------------------
//
// Two decoupled decisions:
//   count 1/2/3 — relative: confidence C plus the fused-score gap to the next
//                 distinct recipe. Near-ties widen the display, never shrink it.
//   abstain (red/empty) — absolute: only when the top hit has weak evidence on
//                 every channel (raw cosine below floor, no BM25 hit, no verb
//                 boost). Crowded-but-plausible lists show 3 + orange instead.
//
// Runtime thresholds.json may override via optional gapExact / gapNarrow /
// abstainCosineFloor fields.

/**
 * Min fused-score gap (S1 − S2, next *distinct* recipe) for the single
 * "exact" slot. Prevents full ties from rendering as an exact match.
 * Calibrated 2026-08 on staging.db × eval banks (860 queries): 0.20 beat
 * 0.15 on hit@display (+12 absolute) with more 3-slot orange displays.
 */
export const DISPLAY_GAP_EXACT = 0.2;

/**
 * Min gap for the 2-result band; below this a high-C list still shows 3.
 * Paired with DISPLAY_GAP_EXACT from the same gate-sweep (local/eval/gate-sweep-report.json).
 */
export const DISPLAY_GAP_NARROW = 0.08;

/**
 * Abstain floor on the top hit's raw cosine similarity (bge-small-en-v1.5).
 * Staging bank cosine p10≈0.75 / min≈0.63; floor 0.6 abstains only junk
 * (no BM25, no verb boost) while floors ≤0.65 were identical on the sweep.
 * Red/empty requires cosine below this AND no BM25 match AND no verb boost.
 */
export const DISPLAY_ABSTAIN_COSINE_FLOOR = 0.6;

/**
 * Default per-channel recall depth for intent KNN and command FTS before fusion.
 * Higher → more candidates / slower search; lower → risk missing the right hit.
 * Runtime thresholds.json may still override recallK for product search.
 */
export const DEFAULT_RECALL_K = 100;

// ---------------------------------------------------------------------------
// Build hard caps & ground/loop job shape
// ---------------------------------------------------------------------------

/**
 * Absolute max recipes in staging/product. Stops ground/loop inserts when hit.
 * Raise for larger catalogs; lower for smoke/debug runs.
 */
export const MAX_COMMANDS = 25_000;

/**
 * Absolute max intent rows. Intent expand + evolve stop inserting when hit.
 * Rough scale: ~10–32 intents per recipe × command count.
 */
export const MAX_INTENTS = 250_000;

/**
 * Evolve loop: stop after this many consecutive cycles with zero new unique
 * recipes (saturation / exhaustion signal).
 * CLI: `--exit-zero-streak=N`
 * Lower → stop sooner; raise → keep pushing when inserts are sparse.
 */
export const LOOP_EXIT_ZERO_STREAK = 3;

/**
 * Parallel ground / evolve jobs (generate → validate → expand → persist).
 * CLI: `--concurrency=N`
 * Bound by CPU, sandbox workers, and LLM provider rate limits. Too high →
 * API 429s and SQLite writer contention; too low → slow builds.
 */
export const BUILD_CONCURRENCY = 24;

/**
 * Max times generate+validate may regenerate a recipe after sandbox/Zod fail
 * before giving up on that group/parent.
 */
export const VALIDATION_MAX_REGEN = 3;

/**
 * Hard timeout (ms) for each sandbox shell/git spawn during validation.
 * Raise for slow machines or heavy recipes; lower to fail-fast hung git.
 */
export const SANDBOX_COMMAND_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Multi-axis evolve loop (coverage / mutation)
// ---------------------------------------------------------------------------

/**
 * Recipes needed per primary verb before that verb can be “saturated”
 * (together with state/flag/composition floors below).
 * Higher → longer loop, denser coverage; lower → earlier saturation exit.
 */
export const LOOP_SATURATION_K = 24;

/**
 * Max parents mutated per evolve cycle (also capped by leaf count).
 * CLI: `--batch-size=N`
 * Larger batches → more LLM/sandbox work per cycle and bigger eval banks.
 */
export const LOOP_MAX_BATCH = 256;

/**
 * Hard max recipe steps (composition inserts refuse to grow past this).
 * Longer recipes hurt Hit@display for multi-step goldens; keep modest.
 */
export const LOOP_MAX_RECIPE_STEPS = 7;

/**
 * Distinct flag-fingerprints required per verb for the flag-coverage axis.
 * Lower → easier saturation; raise → force more flag diversity.
 */
export const LOOP_FLAG_FINGERPRINT_FLOOR = 3;

/**
 * Max flags allowed on a single evolved step (allowlist still applies).
 */
export const LOOP_MAX_FLAGS_PER_STEP = 3;

/**
 * Distinct initial-state buckets required per verb for state-axis saturation
 * (see STATE_BUCKETS in coverage.ts).
 */
export const LOOP_STATE_BUCKET_FLOOR = 3;

// ---------------------------------------------------------------------------
// Intent expansion (per recipe during ground / evolve)
// ---------------------------------------------------------------------------

/**
 * Intents requested from Flash per expand round (also fidelity filter cap
 * per round). Smaller → more rounds / steadier quality; larger → faster fill
 * but noisier batches.
 */
export const INTENT_EXPAND_BATCH = 8;

/**
 * Hard max intents kept per recipe after expand + dedup.
 * Caps DB growth and retrieval clutter per command_id.
 */
export const INTENT_EXPAND_CAP_PER_RECIPE = 32;

/** @deprecated Use INTENT_EXPAND_BATCH — alias for matrix sample / legacy callers. */
export const INTENT_EXPAND_CAP = INTENT_EXPAND_BATCH;

/**
 * Cosine similarity at/above which a new intent is dropped as a near-dup of
 * another keeper **for the same recipe** (inclusive).
 * Lower → stricter uniqueness (fewer intents); higher → allow closer paraphrases.
 */
export const INTENT_WITHIN_COSINE = 0.9;

/**
 * Cosine at/above which a candidate collides with another recipe’s intents
 * (foreign). Triggers rewrite-or-drop.
 * Lower → more aggressive separation across commands; higher → tolerate overlap.
 */
export const INTENT_FOREIGN_COSINE = 0.94;

/**
 * Stop expand when this many consecutive rounds add zero keepers
 * (empty cells remain or all filtered). Prevents infinite LLM spin.
 */
export const INTENT_EXPAND_ZERO_STREAK = 3;

/**
 * Max contrastive rewrites after a foreign collision before dropping the
 * candidate. 0 = drop immediately; >1 = more LLM spend per collision.
 */
export const INTENT_FOREIGN_REWRITE_MAX = 1;

/**
 * KNN depth when probing foreign neighbors during expand / persist.
 * Higher → stricter foreign checks, more DB work.
 */
export const INTENT_FOREIGN_KNN_K = 8;

/**
 * Parallel recipes during improve-round intent re-expand (expand phase).
 * Matches BUILD_CONCURRENCY by default. Write-back (delete+insert) stays
 * serial to avoid SQLite writer races. Raise carefully vs LLM rate limits.
 */
export const INTENT_REEXPAND_CONCURRENCY = 24;

// ---------------------------------------------------------------------------
// Build-time evaluation (dual hard gate)
// ---------------------------------------------------------------------------
//
// Per golden query:
//   1) Hybrid search → CLI displayResults (0–3 slots).
//   2) Hit@display if expected command_id appears among displayed hits.
//   3) Else LLM judge scores utility; Pass A if utility >= JUDGE threshold.
//
// Bank passes only if BOTH rates clear their floors (unless Phase-1 Hit@display
// already cannot reach its floor — then judge is skipped and the bank fails).
//
// CLI overrides (build:loop): --min-hit-at-display --min-pass-rate --judge-utility
//

/**
 * Hard gate: fraction of bank with exact expected `command_id` in displayResults
 * (search-only phase, before judge).
 * Typical band 0.65–0.80. Lower → easier green builds, weaker retrieval bar;
 * raise → force better ranking / catalog coverage.
 * CLI: `--min-hit-at-display=N`
 */
export const EVAL_MIN_HIT_AT_DISPLAY_RATE = 0.7;

/**
 * Hard gate: Pass A = (Hit@display OR judge-pass) rate over the golden bank.
 * Must clear this **and** Hit@display floor for the phase to succeed.
 * Typical band 0.85–0.95. Composition-heavy evolve banks often need a slightly
 * lower floor than ground-only runs.
 * CLI: `--min-pass-rate=N`
 */
export const EVAL_MIN_PASS_RATE = 0.9;

/**
 * Per-query judge: pass if `utility >=` this value (honest 0–1 score; no
 * prompt cliff). Affects Pass A rescues only — does not change Hit@display.
 * Lower → more soft passes on near-miss displays (e.g. switch vs checkout);
 * raise → stricter usefulness bar.
 * CLI: `--judge-utility=N`
 */
export const EVAL_JUDGE_UTILITY_THRESHOLD = 0.8;

/**
 * After eval: max fail-retry recovery attempts when the dual gate is red.
 * CLI: `--eval-fail-retry-max=N`
 */
export const EVAL_GATE_FAIL_RETRY_MAX = 4;

/**
 * After eval: max polish recovery attempts when the gate is green but Pass A
 * is below the nice-to-have (or miss count is high).
 * CLI: `--eval-polish-retry-max=N`
 */
export const EVAL_GATE_POLISH_RETRY_MAX = 2;

/**
 * Polish trigger: run polish recovery if non-pass count >= this.
 * CLI: `--polish-miss-min=N`
 */
export const EVAL_IMPROVE_POLISH_MISS_MIN = 5;

/**
 * Polish trigger / nice-to-have Pass A target.
 * CLI: `--polish-pass-a=N`
 */
export const EVAL_IMPROVE_POLISH_PASS_A = 0.95;

/**
 * Fail-retry: golden hard-bank size must stay >= this fraction of cycle-start.
 */
export const EVAL_GATE_FAIL_BANK_SIZE_FLOOR = 0.85;

/**
 * Polish: golden hard-bank size must stay >= this fraction of polish-start.
 * Drop-only actions that would cut more than (1 - floor) are no-ops.
 */
export const EVAL_GATE_POLISH_BANK_SIZE_FLOOR = 0.95;

/**
 * Loop-phase: absolute hard-golden bank floor before a red gate can stop the run.
 * Below this, eval is advisory (recovery still runs; evolve continues).
 * CLI: `--eval-min-bank-total=N`
 */
export const EVAL_GATE_MIN_BANK_TOTAL = 150;

/**
 * Loop-phase: minimum composition-kind goldens before the gate is binding.
 * CLI: `--eval-min-bank-composition=N`
 */
export const EVAL_GATE_MIN_BANK_COMPOSITION = 30;

/**
 * Judge re-vote band around EVAL_JUDGE_UTILITY_THRESHOLD. First utility inside
 * [threshold - band, threshold + band] triggers additional votes.
 */
export const EVAL_JUDGE_BORDERLINE_BAND = 0.15;

/**
 * Total judge votes (including the first) when borderline; take the median utility.
 */
export const EVAL_JUDGE_VOTES = 3;


/**
 * Recovery: max LLM gap-check calls per attempt (no-verb misses only).
 * CLI: `--eval-gap-check-max=N`
 */
export const EVAL_GAP_CHECK_MAX = 10;

/**
 * Recovery: deeper retrieve size for gap-check (beyond displayResults).
 */
export const EVAL_GAP_CHECK_TOP_K = 10;

/**
 * Recovery: max additive coverage-gap recipe inserts per attempt.
 * CLI: `--eval-coverage-max-inserts=N`
 */
export const EVAL_COVERAGE_MAX_INSERTS = 3;
/**
 * Coverage promote report: warn when a taxonomy verb has fewer than this many
 * accepted recipes (report-only; does not fail the build).
 */
export const EVAL_COVERAGE_WARN_VERB_MIN = 3;

/**
 * Coverage promote report: warn when verb rate / bucket fill is below this
 * fraction of the ideal (report-only).
 */
export const EVAL_COVERAGE_WARN_FRACTION = 0.8;

// ---------------------------------------------------------------------------
// Staging DB meta keys (resume-safe loop progress — do not “tune”)
// ---------------------------------------------------------------------------

export const META_BUILD_LOOP_ITERATION = 'build_loop_iteration';
export const META_BUILD_LOOP_ZERO_STREAK = 'build_loop_zero_streak';
export const META_BUILD_LOOP_MAX_ITERATIONS = 'build_loop_max_iterations';

// ---------------------------------------------------------------------------
// Eval parallelism & progress logging
// ---------------------------------------------------------------------------

/**
 * Parallel golden-bank eval workers (search + judge LLM calls).
 * CLI: `--eval-concurrency=N`
 * Env: `GIT_GRASP_EVAL_CONCURRENCY`
 * High values burn provider QPS; pair with EVAL_SEARCH_POOL_SIZE.
 */
export const EVAL_CONCURRENCY = 64;

/**
 * Readonly SQLite connection pool for concurrent eval search on staging.
 * CLI: `--eval-search-pool=N`
 * Env: `GIT_GRASP_EVAL_SEARCH_POOL`
 * Keep ≥1 and usually ≪ EVAL_CONCURRENCY; raise if search waits on pool.
 */
export const EVAL_SEARCH_POOL_SIZE = 8;

/**
 * Emit eval progress every N completed queries (in addition to the time
 * heartbeat). Lower → noisier logs; raise → quieter long evals.
 */
export const EVAL_PROGRESS_EVERY = 25;

/**
 * Wall-clock heartbeat interval (ms) so long evals still log when query
 * completion is slow.
 */
export const EVAL_PROGRESS_HEARTBEAT_MS = 30_000;
