// @ts-nocheck
export const SCHEMA_VERSION = 7;
export const EMBEDDING_DIM = 384;

/** Hybrid search algorithm version (CLI/web pack must match). */
export const SEARCH_ALGORITHM_VERSION = 1;

/** Default per-channel recall depth (vec intents / FTS). */
export const DEFAULT_RECALL_K = 100;

/** Interactive loop / ground hard caps. */
export const MAX_COMMANDS = 25_000;
export const MAX_INTENTS = 250_000;
export const LOOP_EXIT_ZERO_STREAK = 3;
export const BUILD_CONCURRENCY = 24;
export const VALIDATION_MAX_REGEN = 3;

/** Hard timeout for each sandbox shell/git spawn (ms). */
export const SANDBOX_COMMAND_TIMEOUT_MS = 30_000;

/** Multi-axis evolve loop. */
export const LOOP_SATURATION_K = 24;
export const LOOP_MAX_BATCH = 256;
export const LOOP_MAX_RECIPE_STEPS = 7;
export const LOOP_FLAG_FINGERPRINT_FLOOR = 3;
export const LOOP_MAX_FLAGS_PER_STEP = 3;
/** Intent expand: per-round LLM batch size (fidelity filter cap per round). */
export const INTENT_EXPAND_BATCH = 8;
/** Intent expand: hard max intents kept per recipe. */
export const INTENT_EXPAND_CAP_PER_RECIPE = 32;
/** @deprecated Use INTENT_EXPAND_BATCH — alias for matrix sample / legacy callers. */
export const INTENT_EXPAND_CAP = INTENT_EXPAND_BATCH;
/** Within-recipe near-dup cosine threshold (inclusive drop). */
export const INTENT_WITHIN_COSINE = 0.9;
/** Cross-recipe collision cosine threshold (inclusive). */
export const INTENT_FOREIGN_COSINE = 0.94;
/** Exit expand when this many consecutive rounds add zero keepers. */
export const INTENT_EXPAND_ZERO_STREAK = 3;
/** Max contrastive rewrites per candidate on foreign collision. */
export const INTENT_FOREIGN_REWRITE_MAX = 1;
/** KNN depth for foreign-neighbor checks during expand/persist. */
export const INTENT_FOREIGN_KNN_K = 8;
export const LOOP_STATE_BUCKET_FLOOR = 3;

/** Build-time evaluation (dual gate). */
/** Hard gate: Hit@display-only rate (before LLM judge). */
export const EVAL_MIN_HIT_AT_DISPLAY_RATE = 0.7;
/** Hard gate: Pass A rate after Hit@display OR judge (utility > 0.9). */
export const EVAL_MIN_PASS_RATE = 0.9;
/** Per-query judge pass threshold (utility must be strictly greater). */
export const EVAL_JUDGE_UTILITY_THRESHOLD = 0.9;
export const EVAL_COVERAGE_WARN_VERB_MIN = 3;
export const EVAL_COVERAGE_WARN_FRACTION = 0.8;

/** Staging DB meta keys for resume-safe loop progress. */
export const META_BUILD_LOOP_ITERATION = 'build_loop_iteration';
export const META_BUILD_LOOP_ZERO_STREAK = 'build_loop_zero_streak';
export const META_BUILD_LOOP_MAX_ITERATIONS = 'build_loop_max_iterations';
/** Parallel golden-bank eval concurrency (LLM judge + search). Override: GIT_GRASP_EVAL_CONCURRENCY. */
export const EVAL_CONCURRENCY = 64;
/** Readonly SQLite connections for parallel eval search. Override: GIT_GRASP_EVAL_SEARCH_POOL. */
export const EVAL_SEARCH_POOL_SIZE = 8;
/** Emit eval progress every N completed queries (also time-heartbeat in evaluateBank). */
export const EVAL_PROGRESS_EVERY = 25;
/** Wall-clock heartbeat for long eval (ms). */
export const EVAL_PROGRESS_HEARTBEAT_MS = 30_000;
