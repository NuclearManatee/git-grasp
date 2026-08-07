// @ts-nocheck
/**
 * Build+Eval orchestrator: prepare â†’ ground â†’ interactive loop with staging.
 */
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';
import {
  openDb,
  insertCommand,
  insertIntentWithEmbedding,
  insertCommandEmbedding,
  findCommandByHashPair,
  deleteCommandCascade,
  countCommands,
  countIntents,
  promoteStagingDb,
  getCommand,
  listCommands,
  knnRecall,
  ftsRecall,
  loadGitVerbs,
  finalizeSearchIndex,
  getMetaValue,
  setMetaValue,
} from '../db/schema.js';
import {
  buildStagingDbPath,
  defaultDbPath,
  buildCacheDir,
  semanticBlocksPath,
  defaultThresholdsPath,
} from '../lib/paths.js';
import {
  BUILD_CONCURRENCY,
  LOOP_EXIT_ZERO_STREAK,
  LOOP_MAX_BATCH,
  MAX_COMMANDS,
  MAX_INTENTS,
  EVAL_MIN_PASS_RATE,
  EVAL_MIN_HIT_AT_DISPLAY_RATE,
  EVAL_JUDGE_UTILITY_THRESHOLD,
  EVAL_SEARCH_POOL_SIZE,
  META_BUILD_LOOP_ITERATION,
  META_BUILD_LOOP_ZERO_STREAK,
  META_BUILD_LOOP_MAX_ITERATIONS,
  INTENT_FOREIGN_KNN_K,
} from '../db/constants.js';
import { prepareSemanticBlocks, readSemanticBlocks, loadGitCommandTaxonomy } from './prepare.js';
import { isUnsignedVerifySkip } from './taxonomyScrape.js';
import { generateAndValidate } from './validate.js';
import { expandIntentsForRecipe, evolveByKind } from './generate.js';
import { polishRecipeHygiene } from './polishRecipe.js';
import { shouldPersistIntent } from './intentExpand.js';
import { makeKnnForeign } from './intentSimilarity.js';
import { dedupDecision, findCommandByFingerprint, recipeFingerprint } from './dedup.js';
import { createWriterQueue } from './writerQueue.js';
import {
  appendBank,
  evaluateBank,
  activeEvaluationBank,
  generateGoldenQuery,
  expandQueries,
  tagGolden,
  primaryVerbFromRecipe,
  formatEvalReport,
  formatJudgeVote,
  appendEvolveGolden,
  appendExtendedScrambledBanks,
  buildCoveragePromoteReport,
  writeCoveragePromoteReport,
  verbLookupFromRows,
  evalDataDir,
  loadBank,
  formatEvalProgress,
  formatEvalTiming,
  formatEvolveTiming,
  JUDGE_SYSTEM_PROMPT,
  resolveEvalConcurrency,
  isFallbackGoldenQuery,
  evalBankMeetsFloors,
} from './evalGate.js';
import { runEvalGateRecovery } from './evalRecovery/runEvalGateRecovery.js';
import {
  retrieveEvolutionExamples,
  selectEvolutionParents,
  loopAllVerbsSaturated,
  countLeaves,
} from './loop.js';
import { getEmbedder, mockEmbed } from '../search/embed.js';
import { parseCommands, primaryCommand, renderSnippet } from '../db/recipeFormat.js';
import { searchHybrid } from '../search/hybrid.js';
import { loadThresholds } from '../search/index.js';

function log(...args) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[build ${ts}]`, ...args);
  if (typeof buildLogHook === 'function') {
    const text = args
      .map((a) => (typeof a === 'string' ? a : safeJson(a)))
      .join(' ');
    try {
      buildLogHook(`[build ${ts}] ${text}`);
    } catch {
      // ignore sink errors
    }
  }
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Optional sink for structured run logs (build-loop CLI). */
let buildLogHook = null;
export function setBuildLogHook(fn) {
  buildLogHook = typeof fn === 'function' ? fn : null;
}

function commandEmbedText(row) {
  const steps = parseCommands(row.command_recipe);
  return `${row.initial_state}\n${steps.map((s) => s.command).join('\n')}`;
}

/** Serialize async work (bun:sqlite connection is not concurrent-safe). */
function createAsyncMutex() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(() => fn(), () => fn());
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

function defaultSearchThresholds() {
  try {
    return loadThresholds(defaultThresholdsPath());
  } catch {
    return {
      schemaVersion: 5,
      topK: 3,
      recallK: 100,
      confidenceVeryHigh: 0.9,
      confidenceHigh: 0.75,
      confidenceMedium: 0.4,
      normalizeQuery: true,
    };
  }
}

/**
 * One eval session: finalize FTS/verbs once, then open a readonly connection pool.
 * Local embed is mutex-serialized; each RO conn has its own mutex for sqlite.
 * @param {string} dbPath
 * @returns {Promise<{ search: (query: string) => Promise<*>, close: () => void, poolSize: number }>}
 */
export async function makeEvalSearchSession(dbPath, opts = {}) {
  const embedder = await getEmbedder({
    forceMock: process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1',
  });
  const thresholds = defaultSearchThresholds();
  const poolSize = resolveEvalSearchPoolSize(opts);

  // Finalize index on a writable handle, then close it so readers see a stable file.
  const writeDb = openDb(dbPath, { readonly: false });
  finalizeSearchIndex(writeDb);
  const verbs = loadGitVerbs(writeDb);
  writeDb.close();

  const withEmbed = createAsyncMutex();
  /** @type {{ db: *, withDb: (fn: Function) => Promise<*> }[]} */
  const pool = [];
  for (let i = 0; i < poolSize; i += 1) {
    const db = openDb(dbPath, { readonly: true });
    pool.push({ db, withDb: createAsyncMutex() });
  }

  let cursor = 0;
  const acquireSlot = () => {
    const slot = pool[cursor % pool.length];
    cursor += 1;
    return slot;
  };

  const search = async (query) => {
    const vec = await withEmbed(async () => embedder.embed(query));
    const slot = acquireSlot();
    return slot.withDb(async () => {
      const db = slot.db;
      return searchHybrid({
        query,
        thresholds,
        preferredSkillOverride: null,
        verbs,
        embed: async () => vec,
        knn: (v, k) => knnRecall(db, v, k),
        fts: (q, k) => ftsRecall(db, q, k),
        hydrate: (ids) =>
          ids.map((id) => {
            const row = getCommand(db, id);
            if (!row) {
              return { command_id: id, commands: [], example: '', snippet: '', risk: 0 };
            }
            const commands = parseCommands(row.command_recipe);
            return {
              command_id: Number(row.row_id),
              commands,
              example: primaryCommand(commands) || '',
              snippet: renderSnippet(commands),
              risk: Number(row.risk ?? 0),
            };
          }),
      });
    });
  };

  return {
    search,
    poolSize,
    close() {
      for (const slot of pool) {
        try {
          slot.db.close();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/** Resolve readonly eval search pool size (opts > env > default). */
export function resolveEvalSearchPoolSize(opts = {}) {
  if (opts.poolSize != null && Number.isFinite(Number(opts.poolSize))) {
    return Math.max(1, Math.floor(Number(opts.poolSize)));
  }
  const env = process.env.GIT_GRASP_EVAL_SEARCH_POOL;
  if (env != null && String(env).trim() !== '') {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  return EVAL_SEARCH_POOL_SIZE;
}

function persistLoopProgress(db, { iteration, zeroStreak, maxIterations }) {
  setMetaValue(db, META_BUILD_LOOP_ITERATION, String(iteration));
  setMetaValue(db, META_BUILD_LOOP_ZERO_STREAK, String(zeroStreak));
  if (maxIterations != null) {
    setMetaValue(db, META_BUILD_LOOP_MAX_ITERATIONS, String(maxIterations));
  }
}

function loadLoopProgress(db) {
  const iterRaw = getMetaValue(db, META_BUILD_LOOP_ITERATION);
  const zeroRaw = getMetaValue(db, META_BUILD_LOOP_ZERO_STREAK);
  const maxRaw = getMetaValue(db, META_BUILD_LOOP_MAX_ITERATIONS);
  const iteration = Number(iterRaw);
  const zeroStreak = Number(zeroRaw);
  const savedMax = Number(maxRaw);
  return {
    iteration: Number.isFinite(iteration) && iteration > 0 ? Math.floor(iteration) : 0,
    zeroStreak: Number.isFinite(zeroStreak) && zeroStreak > 0 ? Math.floor(zeroStreak) : 0,
    savedMaxIterations:
      Number.isFinite(savedMax) && savedMax > 0 ? Math.floor(savedMax) : null,
  };
}

async function runBankEval(bank, stagingPath, opts = {}) {
  const minPassRate = opts.minPassRate ?? EVAL_MIN_PASS_RATE;
  const minHitAtDisplayRate = opts.minHitAtDisplayRate ?? EVAL_MIN_HIT_AT_DISPLAY_RATE;
  const verbLookup = opts.verbLookup;
  const onProgress =
    opts.onProgress ||
    ((p) => {
      log(formatEvalProgress(p));
    });
  const onJudgeVote =
    opts.onJudgeVote ||
    ((vote) => {
      log(formatJudgeVote(vote));
    });
  const onSkipJudge =
    opts.onSkipJudge ||
    ((info) => {
      log(
        `eval skipJudge hitRate=${(info.hitRate ?? 0).toFixed(2)} < minHitAtDisplay=${info.minHitAtDisplayRate}`,
      );
    });

  log(
    `eval criteria hit@display>=${minHitAtDisplayRate} passA>=${minPassRate} judgeUtil>=${opts.utilityThreshold ?? EVAL_JUDGE_UTILITY_THRESHOLD}`,
  );
  log(`eval judgePrompt ${JUDGE_SYSTEM_PROMPT.replace(/\s+/g, ' ').trim()}`);

  const evalOpts = {
    llmJsonObject: opts.llmJsonObject,
    minPassRate,
    minHitAtDisplayRate,
    utilityThreshold: opts.utilityThreshold,
    verbLookup,
    concurrency: opts.evalConcurrency,
    onProgress,
    onJudgeVote,
    onSkipJudge,
  };

  if (opts.searchFn) {
    const result = await evaluateBank(bank, opts.searchFn, evalOpts);
    if (result.timing) log(formatEvalTiming(result.timing));
    return result;
  }

  const poolSize = resolveEvalSearchPoolSize({
    poolSize: opts.searchPoolSize,
  });
  const concurrency = resolveEvalConcurrency({ concurrency: opts.evalConcurrency });
  log(
    `eval session open staging=${stagingPath} bank=${bank.length} pool=${poolSize} concurrency=${concurrency}`,
  );
  const session = await makeEvalSearchSession(stagingPath, {
    poolSize,
  });
  try {
    const result = await evaluateBank(bank, session.search, evalOpts);
    if (result.timing) log(formatEvalTiming(result.timing));
    return result;
  } finally {
    session.close();
    log(`eval session closed`);
  }
}

export function wipeBuildCache() {
  // Only wipe ephemeral ground/loop artifacts â€” never Step âˆ’1 prepare output.
  const dir = buildCacheDir();
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  log(`wiped build cache â†’ ${dir} (Step âˆ’1 prepare kept)`);
}

export function wipeEvalBanks() {
  const evalDir = evalDataDir();
  if (existsSync(evalDir)) {
    rmSync(evalDir, { recursive: true, force: true });
    log(`wiped eval banks â†’ ${evalDir}`);
  }
}

/**
 * Authoritative persist-time prune (within + foreign cosine). Drop only — no rewrite.
 * @param {object} d db handle
 * @param {{ embed: (t: string) => Promise<Float32Array|number[]> }} embedder
 * @param {object} intent
 * @param {number} commandId
 * @param {(Float32Array|number[])[]} existingEmbeddings
 */
async function persistIntentIfAllowed(d, embedder, intent, commandId, existingEmbeddings) {
  const emb = await embedder.embed(intent.intent_text);
  const knnForeign = makeKnnForeign(d, knnRecall, INTENT_FOREIGN_KNN_K);
  const gate = await shouldPersistIntent({
    intent_text: intent.intent_text,
    embedding: emb,
    existingEmbeddings,
    knnForeign,
    selfCommandId: commandId,
  });
  if (!gate.ok) return { inserted: false, reason: gate.reason, embedding: emb };
  insertIntentWithEmbedding(d, {
    command_id: commandId,
    skill_level: intent.skill_level,
    intent_category: intent.intent_category,
    intent_text: intent.intent_text,
    embedding: emb,
  });
  existingEmbeddings.push(emb);
  return { inserted: true, reason: 'ok', embedding: emb };
}

async function persistAccepted(db, writer, accepted, embedder) {
  return writer.run(async (d) => {
    let existing = findCommandByHashPair(
      d,
      accepted.initial_state_physical_hash,
      accepted.final_state_physical_hash,
    );
    // Secondary key: normalized recipe fingerprint.
    if (!existing) {
      existing = findCommandByFingerprint(d, recipeFingerprint(accepted.command_recipe));
    }
    const decision = dedupDecision(existing, accepted);
    if (decision === 'keep_existing') {
      // Merge any new intents onto survivor (exact text + cosine prune).
      const intents = accepted.intents || [];
      if (intents.length) {
        const rawDb = d._db ?? d;
        const existingRows = rawDb
          .prepare(`SELECT intent_text FROM intents WHERE command_id = ?`)
          .all(existing.row_id);
        const existingTexts = new Set(
          existingRows.map((r) =>
            String(r.intent_text || '')
              .toLowerCase()
              .trim(),
          ),
        );
        /** @type {(Float32Array|number[])[]} */
        const existingEmbeddings = [];
        for (const r of existingRows) {
          existingEmbeddings.push(await embedder.embed(String(r.intent_text || '')));
        }
        for (const intent of intents) {
          const key = String(intent.intent_text || '')
            .toLowerCase()
            .trim();
          if (!key || existingTexts.has(key)) continue;
          existingTexts.add(key);
          await persistIntentIfAllowed(
            d,
            embedder,
            intent,
            existing.row_id,
            existingEmbeddings,
          );
        }
      }
      return { inserted: false, row_id: existing.row_id, reason: 'dedup_keep' };
    }
    if (decision === 'replace_existing') {
      deleteCommandCascade(d, existing.row_id);
    }
    const row_id = insertCommand(d, {
      initial_state: accepted.initial_state,
      command_recipe: accepted.command_recipe,
      initial_state_physical_hash: accepted.initial_state_physical_hash,
      final_state_physical_hash: accepted.final_state_physical_hash,
      risk: accepted.risk,
      parent_row_id: accepted.parent_row_id ?? null,
      mutation_kind: accepted.mutation_kind ?? null,
      title: accepted.title ?? null,
    });
    const intents = accepted.intents || [];
    /** @type {(Float32Array|number[])[]} */
    const existingEmbeddings = [];
    for (const intent of intents) {
      await persistIntentIfAllowed(d, embedder, intent, row_id, existingEmbeddings);
    }
    const cEmb = await embedder.embed(
      commandEmbedText({ ...accepted, command_recipe: accepted.command_recipe }),
    );
    insertCommandEmbedding(d, row_id, cEmb);
    return { inserted: true, row_id, reason: decision };
  });
}

/**
 * Ground steps 1â€“4 over semantic_blocks into staging.
 */
export async function runGroundStep(opts = {}) {
  mkdirSync(buildCacheDir(), { recursive: true });
  const stagingPath = opts.stagingPath || buildStagingDbPath();
  if (existsSync(stagingPath) && opts.fresh !== false) {
    try {
      rmSync(stagingPath, { force: true });
    } catch (e) {
      const alt = stagingPath.replace(/\.db$/i, `.${Date.now()}.db`);
      console.warn(`Could not remove ${stagingPath} (${e?.message || e}); using ${alt}`);
      opts.stagingPath = alt;
    }
  }
  const resolvedStaging = opts.stagingPath || stagingPath;
  log(`ground open staging=${resolvedStaging}`);
  const db = openDb(resolvedStaging);
  const writer = createWriterQueue(db);
  const mock = opts.mock || process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1';
  log(`ground embedder=${mock ? 'mock' : 'minilm'}`);
  const embedder = mock
    ? { embed: async (t) => mockEmbed(t) }
    : await getEmbedder({ forceMock: false });

  let groups = opts.groups;
  if (!groups) {
    if (!existsSync(semanticBlocksPath())) {
      throw new Error(
        `Missing Step −1 artifact at ${semanticBlocksPath()}. Run: bun run build:prepare`,
      );
    }
    groups = readSemanticBlocks();
    if (!groups.length) {
      throw new Error(
        `Step −1 artifact is empty at ${semanticBlocksPath()}. Re-run: bun run build:prepare --force`,
      );
    }
  }

  // Skip unavailable / verify-unsigned even if stale prepare blocks remain.
  const taxonomy = opts.skipAvailabilityFilter
    ? null
    : (() => {
        try {
          return loadGitCommandTaxonomy();
        } catch {
          return null;
        }
      })();
  const availabilityByCommand = new Map();
  if (taxonomy?.commands) {
    for (const c of taxonomy.commands) {
      availabilityByCommand.set(c.command, c);
    }
  }
  const skips = [];
  const filteredGroups = [];
  for (let idx = 0; idx < groups.length; idx += 1) {
    const group = groups[idx];
    const cmd = group.command || '';
    const meta = availabilityByCommand.get(cmd);
    if (meta && meta.available === false) {
      skips.push({ idx, command: cmd, reason: 'unavailable' });
      continue;
    }
    if (isUnsignedVerifySkip(cmd) && !opts.allowUnsignedVerify) {
      skips.push({ idx, command: cmd, reason: 'verify_unsigned' });
      continue;
    }
    filteredGroups.push({ group, idx });
  }
  if (skips.length) {
    log(`ground skip ${skips.length}: ${skips.map((s) => `${s.command}:${s.reason}`).join(', ')}`);
  }
  groups = filteredGroups.map((x) => x.group);
  const indexMap = filteredGroups.map((x) => x.idx);

  const concurrency = opts.concurrency ?? BUILD_CONCURRENCY;
  log(`ground start groups=${groups.length} concurrency=${concurrency}`);
  const limit = pLimit(concurrency);
  const inserted = [];
  const errors = [];
  let done = 0;

  await Promise.all(
    groups.map((group, i) =>
      limit(async () => {
        const idx = indexMap[i] ?? i;
        if (countCommands(db) >= MAX_COMMANDS || countIntents(db) >= MAX_INTENTS) return;
        const label = group.command || `group-${idx}`;
        try {
          log(`ground[${i + 1}/${groups.length}] generate+validate "${label}"`);
          const validated = await generateAndValidate(group, {
            workerId: i % concurrency,
            jobId: `ground-${idx}`,
            llmJsonObject: opts.llmJsonObject,
            generate: opts.generate,
            validate: opts.validate,
          });
          if (!validated.ok) {
            errors.push({ idx, reason: validated.reason });
            log(`ground[${i + 1}/${groups.length}] FAIL validate reason=${validated.reason}`);
            return;
          }
          const polished = opts.skipPolish
            ? validated
            : await polishRecipeHygiene(validated, {
                llmJsonObject: opts.llmJsonObject,
                validate: opts.validate,
                workerId: i % concurrency,
                jobId: `ground-polish-${idx}`,
                log: (m) => log(`ground[${i + 1}/${groups.length}] ${m}`),
              });
          log(`ground[${i + 1}/${groups.length}] expand intents`);
          const knnForeign = makeKnnForeign(db, knnRecall, INTENT_FOREIGN_KNN_K);
          const intents = opts.expandIntents
            ? await opts.expandIntents(polished)
            : await expandIntentsForRecipe(polished, {
                llmJsonObject: opts.llmJsonObject,
                embedder,
                knnForeign,
              });
          const list = Array.isArray(intents) ? intents : [];
          const persisted = await persistAccepted(
            db,
            writer,
            { ...polished, intents: list },
            embedder,
          );
          if (persisted.inserted) {
            inserted.push(persisted.row_id);
            log(`ground[${i + 1}/${groups.length}] INSERT row_id=${persisted.row_id} intents=${list.length}`);
            if (!opts.skipEvalBanks) {
              const row =
                getCommand(db, persisted.row_id) ||
                {
                  row_id: persisted.row_id,
                  initial_state: validated.initial_state,
                  command_recipe: validated.command_recipe,
                  mutation_kind: null,
                };
              const goldenRaw = opts.generateGolden
                ? await opts.generateGolden(row, persisted.row_id)
                : await generateGoldenQuery(row, persisted.row_id, {
                    llmJsonObject: opts.llmJsonObject,
                    priorQueries: loadBank('golden.jsonl').map((r) => r.query_text),
                  });
              const groundRow = { ...row, mutation_kind: 'ground' };
              const golden = tagGolden(goldenRaw, {
                mutation_kind: 'ground',
                primary_verb: primaryVerbFromRecipe(groundRow),
                source: 'llm',
              });
              appendBank('golden.jsonl', [golden]);
              const extendedRaw = opts.expandQueries
                ? await opts.expandQueries(golden, groundRow)
                : await expandQueries(golden, groundRow, { llmJsonObject: opts.llmJsonObject });
              const { extended } = appendExtendedScrambledBanks(
                groundRow,
                extendedRaw,
                persisted.row_id,
              );
              log(`ground[${i + 1}/${groups.length}] eval banks +golden +${extended.length} extended`);
            }
          } else {
            log(`ground[${i + 1}/${groups.length}] DEDUP keep existing row_id=${persisted.row_id}`);
          }
        } catch (e) {
          errors.push({ idx, reason: e?.message || String(e) });
          log(`ground[${i + 1}/${groups.length}] ERROR ${e?.message || e}`);
        } finally {
          done += 1;
          if (done % 5 === 0 || done === groups.length) {
            log(`ground progress ${done}/${groups.length} inserted=${inserted.length} errors=${errors.length}`);
          }
        }
      }),
    ),
  );

  let evalResult = { ok: true, skipped: true };
  if (!opts.skipEval && inserted.length) {
    // Hard gate on golden only (exclude fallback "how do I use git X").
    const bank = activeEvaluationBank({ kinds: ['golden'], excludeFallbacks: true });
    const minPassRate = opts.minPassRate ?? EVAL_MIN_PASS_RATE;
    const minHitAtDisplayRate = opts.minHitAtDisplayRate ?? EVAL_MIN_HIT_AT_DISPLAY_RATE;
    log(
      `ground eval bank size=${bank.length} minHitAtDisplay=${minHitAtDisplayRate} minPassRate=${minPassRate}`,
    );
    const verbLookup = verbLookupFromRows(listCommands(db));
    evalResult = await runBankEval(bank, resolvedStaging, {
      llmJsonObject: opts.llmJsonObject,
      minPassRate,
      minHitAtDisplayRate,
      utilityThreshold: opts.utilityThreshold,
      verbLookup,
      searchFn: opts.searchFn,
      evalConcurrency: opts.evalConcurrency,
      searchPoolSize: opts.searchPoolSize,
      onProgress: opts.onEvalProgress,
      onJudgeVote: opts.onJudgeVote,
    });
    log(formatEvalReport(evalResult));
    if (typeof opts.onEvalReport === 'function') opts.onEvalReport(evalResult, { phase: 'ground' });

    let taxonomyVerbs = opts.taxonomyVerbs;
    if (!taxonomyVerbs) {
      try {
        taxonomyVerbs = loadGitCommandTaxonomy().commands.map((c) => c.command);
      } catch {
        taxonomyVerbs = [];
      }
    }
    const recoveryArtifactsDir =
      typeof opts.recoveryArtifactsDir === 'function'
        ? opts.recoveryArtifactsDir({ phase: 'ground' })
        : opts.recoveryArtifactsDir ||
          (typeof opts.improveArtifactsDir === 'function'
            ? opts.improveArtifactsDir({ phase: 'ground' })
            : opts.improveArtifactsDir);
    const recoveryOut = await runEvalGateRecovery({
      phase: 'ground',
      evalResult,
      skipEvalRecovery: opts.skipEvalRecovery,
      skipEvalImprove: opts.skipEvalImprove,
      evalFailRetryMax: opts.evalFailRetryMax,
      evalPolishRetryMax: opts.evalPolishRetryMax,
      polishMissMin: opts.polishMissMin,
      polishPassA: opts.polishPassA,
      stagingPath: resolvedStaging,
      db,
      embedder,
      runBankEval,
      reloadBank: () =>
        activeEvaluationBank({ kinds: ['golden'], excludeFallbacks: true }),
      taxonomyVerbs,
      verbLookup,
      llmJsonObject: opts.llmJsonObject,
      trapsPath: opts.trapsPath,
      familiesPath: opts.familiesPath,
      expandIntents: opts.expandIntents,
      minPassRate,
      minHitAtDisplayRate,
      utilityThreshold: opts.utilityThreshold,
      searchFn: opts.searchFn,
      evalConcurrency: opts.evalConcurrency,
      searchPoolSize: opts.searchPoolSize,
      artifactsDir: recoveryArtifactsDir,
      log: (m) => log(m),
    });
    if (recoveryOut.ran) {
      evalResult = recoveryOut.evalResult;
      log(formatEvalReport(evalResult));
      if (typeof opts.onEvalReport === 'function') {
        opts.onEvalReport(evalResult, {
          phase: 'ground',
          recovery: recoveryOut,
        });
      }
    }
  }

  const cmdCount = countCommands(db);
  const intentCount = countIntents(db);
  db.close();
  const ok =
    (inserted.length > 0 || groups.length === 0) &&
    (evalResult.ok !== false) &&
    errors.length < groups.length;
  log(`ground done ok=${ok} commands=${cmdCount} intents=${intentCount} inserted=${inserted.length} errors=${errors.length} skips=${skips.length}`);
  return {
    ok,
    inserted: inserted.length,
    errors,
    skips,
    stagingPath: resolvedStaging,
    eval: evalResult,
    commands: cmdCount,
  };
}

export async function runBuildLoop(opts = {}) {
  if (opts.wipe !== false) {
    wipeBuildCache();
  }
  if (opts.prepare === true) {
    log(`prepare start`);
    await prepareSemanticBlocks({
      embedder: opts.prepareEmbedder,
      sources: opts.sources,
      log: (m) => log(m),
    });
    log(`prepare done`);
  }

  let ground = { ok: true, stagingPath: opts.stagingPath || buildStagingDbPath(), skipped: true };
  if (!opts.skipGround) {
    ground = await runGroundStep({
      ...opts,
      fresh: opts.wipe !== false,
    });
    if (!ground.ok && !opts.continueOnEvalKo) {
      return {
        ok: false,
        phase: 'ground',
        ground,
        message: 'Eval KO after ground step â€” analyze post-mortems before continuing',
        ko: ground.eval,
      };
    }
  }

  const stagingPath = ground.stagingPath || buildStagingDbPath();
  if (!existsSync(stagingPath)) {
    return {
      ok: false,
      phase: 'loop',
      message: `Missing staging DB at ${stagingPath} â€” run build:ground first`,
    };
  }
  log(`loop staging=${stagingPath} skipGround=${Boolean(opts.skipGround)}`);
  const mock = opts.mock || process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1';
  const embedder = mock
    ? { embed: async (t) => mockEmbed(t) }
    : await getEmbedder({ forceMock: false });
  log(`loop embedder=${mock ? 'mock' : 'minilm'}`);

  // Resume-safe: iteration / zeroStreak live on the staging dataset meta.
  let zeroStreak = 0;
  let iteration = 0;
  let maxIter = opts.maxIterations ?? 100;
  {
    const progressDb = openDb(stagingPath);
    try {
      const saved = loadLoopProgress(progressDb);
      zeroStreak = saved.zeroStreak;
      iteration = saved.iteration;
      maxIter = opts.maxIterations ?? saved.savedMaxIterations ?? 100;
      if (opts.maxIterations != null) {
        persistLoopProgress(progressDb, {
          iteration,
          zeroStreak,
          maxIterations: maxIter,
        });
      }
      if (iteration > 0 || zeroStreak > 0) {
        log(
          `loop resume from staging meta iteration=${iteration} zeroStreak=${zeroStreak} maxIterations=${maxIter}`,
        );
      }
    } finally {
      progressDb.close();
    }
  }
  const concurrency = opts.concurrency ?? BUILD_CONCURRENCY;
  const exitZero = opts.exitZeroStreak ?? LOOP_EXIT_ZERO_STREAK;
  let taxonomyVerbs = opts.taxonomyVerbs;
  if (!taxonomyVerbs) {
    try {
      taxonomyVerbs = loadGitCommandTaxonomy().commands.map((c) => c.command);
    } catch {
      taxonomyVerbs = [];
    }
  }
  /** @type {object|null} */
  let lastEvalResult = null;

  while (iteration < maxIter) {
    iteration += 1;
    const db = openDb(stagingPath);
    const cmds = countCommands(db);
    const ints = countIntents(db);
    log(`loop iter=${iteration}/${maxIter} commands=${cmds} intents=${ints} zeroStreak=${zeroStreak}/${exitZero}`);
    if (cmds >= MAX_COMMANDS || ints >= MAX_INTENTS) {
      log(`loop hit cap commands=${cmds}/${MAX_COMMANDS} intents=${ints}/${MAX_INTENTS}`);
      db.close();
      break;
    }

    if (taxonomyVerbs.length && loopAllVerbsSaturated(db, taxonomyVerbs)) {
      log(`loop exit: all taxonomy verbs saturated`);
      db.close();
      break;
    }

    const leafCount = countLeaves(db);
    const batchSize = Math.min(
      leafCount,
      opts.batchSize ?? LOOP_MAX_BATCH,
    );
    const parents = selectEvolutionParents(db, batchSize);
    log(
      `loop iter=${iteration} evolve parents=${parents.length} leaves=${leafCount} batchCap=${batchSize} concurrency=${concurrency}`,
    );
    const writer = createWriterQueue(db);
    const limit = pLimit(concurrency);
    let newUnique = 0;
    let evolvedOk = 0;
    let evolvedFail = 0;
    let evolveDone = 0;
    let lastEvolveProgressAt = Date.now();
    const batchIds = [];
    const evolveStartedAt = Date.now();
    const evolveTiming = {
      llmMs: 0,
      sandboxMs: 0,
      intentsMs: 0,
      goldenMs: 0,
      persistMs: 0,
      parentsDone: 0,
    };

    await Promise.all(
      parents.map((parent, idx) =>
        limit(async () => {
          if (countCommands(db) >= MAX_COMMANDS) return;
          const kind = parent.mutation_kind || 'state';
          try {
            log(
              `loop iter=${iteration} parent[${idx + 1}/${parents.length}] row_id=${parent.row_id} kind=${kind}`,
            );
            const examples = await retrieveEvolutionExamples(
              db,
              parent,
              (t) => embedder.embed(t),
              { mutationKind: kind },
            );
            const tLlm = Date.now();
            const evolved = opts.evolve
              ? await opts.evolve(parent, examples, kind)
              : await evolveByKind(kind, parent, examples, {
                  llmJsonObject: opts.llmJsonObject,
                });
            evolveTiming.llmMs += Date.now() - tLlm;
            const recipe =
              typeof evolved.command_recipe === 'string'
                ? JSON.parse(evolved.command_recipe)
                : evolved.command_recipe;
            const mutation_kind = evolved.mutation_kind || kind;
            const tSandbox = Date.now();
            const validated = await generateAndValidate(
              {
                command: primaryCommand(recipe) || 'git',
                blocks: [
                  {
                    metadata_source: 'evolve/parent',
                    content: `parent_row_id=${parent.row_id} mutation=${mutation_kind}`,
                  },
                ],
              },
              {
                generate: async () => ({
                  ...evolved,
                  command_recipe: recipe,
                  mutation_kind,
                }),
                validate: opts.validate,
                workerId: idx,
                jobId: `loop-${iteration}-${idx}`,
                llmJsonObject: opts.llmJsonObject,
              },
            );
            evolveTiming.sandboxMs += Date.now() - tSandbox;
            if (!validated.ok) {
              evolvedFail += 1;
              log(`loop iter=${iteration} parent=${parent.row_id} validate FAIL ${validated.reason}`);
              return;
            }
            const polished = opts.skipPolish
              ? validated
              : await polishRecipeHygiene(
                  { ...validated, mutation_kind },
                  {
                    llmJsonObject: opts.llmJsonObject,
                    validate: opts.validate,
                    workerId: idx,
                    jobId: `loop-polish-${iteration}-${idx}`,
                    log: (m) => log(`loop iter=${iteration} ${m}`),
                  },
                );
            const tIntents = Date.now();
            const knnForeign = makeKnnForeign(db, knnRecall, INTENT_FOREIGN_KNN_K);
            const intents = opts.expandIntents
              ? await opts.expandIntents(polished)
              : await expandIntentsForRecipe(
                  { ...polished, mutation_kind },
                  {
                    llmJsonObject: opts.llmJsonObject,
                    embedder,
                    knnForeign,
                  },
                );
            evolveTiming.intentsMs += Date.now() - tIntents;
            const list = Array.isArray(intents) ? intents : [];
            const tPersist = Date.now();
            const persisted = await persistAccepted(
              db,
              writer,
              {
                ...polished,
                intents: list,
                parent_row_id: parent.row_id,
                mutation_kind,
              },
              embedder,
            );
            evolveTiming.persistMs += Date.now() - tPersist;
            evolvedOk += 1;
            if (persisted.inserted) {
              newUnique += 1;
              batchIds.push(persisted.row_id);
              log(
                `loop iter=${iteration} parent=${parent.row_id} INSERT child=${persisted.row_id} kind=${mutation_kind}`,
              );
              // One golden + extended/scrambled per accepted evolve insert (no cap).
              if (!opts.skipEvalBanks) {
                const childRow =
                  getCommand(db, persisted.row_id) ||
                  ({
                    ...validated,
                    row_id: persisted.row_id,
                    mutation_kind,
                  } as any);
                const evolveRow = { ...childRow, mutation_kind };
                const tGolden = Date.now();
                const goldenRaw = opts.generateGolden
                  ? await opts.generateGolden(evolveRow, persisted.row_id)
                  : await generateGoldenQuery(evolveRow, persisted.row_id, {
                      llmJsonObject: opts.llmJsonObject,
                      priorQueries: loadBank('golden.jsonl').map((r) => r.query_text),
                    });
                const golden = appendEvolveGolden(evolveRow, goldenRaw);
                const extendedRaw = opts.expandQueries
                  ? await opts.expandQueries(golden, evolveRow)
                  : await expandQueries(golden, evolveRow, {
                      llmJsonObject: opts.llmJsonObject,
                    });
                const { extended } = appendExtendedScrambledBanks(
                  evolveRow,
                  extendedRaw,
                  persisted.row_id,
                );
                evolveTiming.goldenMs += Date.now() - tGolden;
                log(
                  `loop iter=${iteration} +golden +${extended.length} extended child=${persisted.row_id} kind=${mutation_kind}`,
                );
              }
            } else {
              log(`loop iter=${iteration} parent=${parent.row_id} DEDUP ${persisted.reason}`);
            }
          } catch (e) {
            evolvedFail += 1;
            log(`loop iter=${iteration} parent=${parent.row_id} ERROR ${e?.message || e}`);
          } finally {
            evolveDone += 1;
            evolveTiming.parentsDone = evolveDone;
            const now = Date.now();
            if (
              evolveDone % 5 === 0 ||
              evolveDone === parents.length ||
              now - lastEvolveProgressAt >= 30_000
            ) {
              lastEvolveProgressAt = now;
              log(
                `evolve progress ${evolveDone}/${parents.length} ok=${evolvedOk} fail=${evolvedFail} newUnique=${newUnique} elapsed=${Math.round((now - evolveStartedAt) / 1000)}s`,
              );
            }
          }
        }),
      ),
    );

    log(formatEvolveTiming(evolveTiming));

    const bank = activeEvaluationBank({ kinds: ['golden'], excludeFallbacks: true });
    const minPassRate = opts.minPassRate ?? EVAL_MIN_PASS_RATE;
    const minHitAtDisplayRate = opts.minHitAtDisplayRate ?? EVAL_MIN_HIT_AT_DISPLAY_RATE;
    log(
      `loop iter=${iteration} evolve done ok=${evolvedOk} fail=${evolvedFail} newUnique=${newUnique}; eval bank=${bank.length} minHitAtDisplay=${minHitAtDisplayRate} minPassRate=${minPassRate}`,
    );
    const verbLookup = verbLookupFromRows(listCommands(db));
    let evalResult = await runBankEval(bank, stagingPath, {
      llmJsonObject: opts.llmJsonObject,
      minPassRate,
      minHitAtDisplayRate,
      utilityThreshold: opts.utilityThreshold,
      verbLookup,
      searchFn: opts.searchFn,
      evalConcurrency: opts.evalConcurrency,
      searchPoolSize: opts.searchPoolSize,
      onProgress: opts.onEvalProgress,
      onJudgeVote: opts.onJudgeVote,
    });
    log(formatEvalReport(evalResult));
    if (typeof opts.onEvalReport === 'function') {
      opts.onEvalReport(evalResult, { phase: 'loop', iteration });
    }

    const recoveryArtifactsDir =
      typeof opts.recoveryArtifactsDir === 'function'
        ? opts.recoveryArtifactsDir({ phase: 'loop', iteration })
        : opts.recoveryArtifactsDir ||
          (typeof opts.improveArtifactsDir === 'function'
            ? opts.improveArtifactsDir({ phase: 'loop', iteration })
            : opts.improveArtifactsDir);
    const recoveryOut = await runEvalGateRecovery({
      phase: 'loop',
      evalResult,
      skipEvalRecovery: opts.skipEvalRecovery,
      skipEvalImprove: opts.skipEvalImprove,
      evalFailRetryMax: opts.evalFailRetryMax,
      evalPolishRetryMax: opts.evalPolishRetryMax,
      polishMissMin: opts.polishMissMin,
      polishPassA: opts.polishPassA,
      stagingPath,
      db,
      embedder,
      runBankEval,
      reloadBank: () =>
        activeEvaluationBank({ kinds: ['golden'], excludeFallbacks: true }),
      taxonomyVerbs,
      verbLookup,
      llmJsonObject: opts.llmJsonObject,
      trapsPath: opts.trapsPath,
      familiesPath: opts.familiesPath,
      expandIntents: opts.expandIntents,
      minPassRate,
      minHitAtDisplayRate,
      utilityThreshold: opts.utilityThreshold,
      searchFn: opts.searchFn,
      evalConcurrency: opts.evalConcurrency,
      searchPoolSize: opts.searchPoolSize,
      artifactsDir: recoveryArtifactsDir,
      log: (m) => log(m),
    });
    if (recoveryOut.ran) {
      evalResult = recoveryOut.evalResult;
      log(formatEvalReport(evalResult));
      if (typeof opts.onEvalReport === 'function') {
        opts.onEvalReport(evalResult, {
          phase: 'loop',
          iteration,
          recovery: recoveryOut,
        });
      }
    }
    lastEvalResult = evalResult;

    if (!evalResult.ok) {
      const bankNow = activeEvaluationBank({
        kinds: ['golden'],
        excludeFallbacks: true,
      });
      const floors = evalBankMeetsFloors(bankNow, {
        minTotal: opts.evalMinBankTotal,
        minComposition: opts.evalMinBankComposition,
      });
      if (!floors.ok) {
        // Advisory: bank still below absolute floors — keep evolving.
        log(
          `loop eval KO advisory (bank total=${floors.total}/${floors.totalMin} composition=${floors.composition}/${floors.compMin}) — continuing evolve`,
        );
      } else if (opts.continueOnEvalKo) {
        log(
          `loop eval KO at iter=${iteration} but --continue-on-eval-ko — continuing`,
        );
      } else {
        // Binding: floors met and gate red — stop.
        persistLoopProgress(db, {
          iteration: Math.max(0, iteration - 1),
          zeroStreak,
          maxIterations: maxIter,
        });
        db.close();
        log(
          `loop KO at iter=${iteration} — stopping (resume will retry from ${Math.max(0, iteration - 1)}; bank floors met=${floors.ok})`,
        );
        return {
          ok: false,
          phase: 'loop',
          iteration,
          newUnique,
          eval: {
            ok: evalResult.ok,
            okHit: evalResult.okHit,
            okPass: evalResult.okPass,
            passed: evalResult.passed,
            hitPassed: evalResult.hitPassed,
            judgePassed: evalResult.judgePassed,
            total: evalResult.total,
            rate: evalResult.rate,
            hitRate: evalResult.hitRate,
            minPassRate: evalResult.minPassRate,
            minHitAtDisplayRate: evalResult.minHitAtDisplayRate,
            verbRate: evalResult.verbRate,
            byMutationKind: evalResult.byMutationKind,
            judgeSummary: evalResult.judgeSummary,
          },
          message: 'Eval KO — analyze and propose fix',
          stagingPath,
          bankFloors: floors,
        };
      }
    }

    if (newUnique === 0) zeroStreak += 1;
    else zeroStreak = 0;
    persistLoopProgress(db, { iteration, zeroStreak, maxIterations: maxIter });
    log(`loop iter=${iteration} zeroStreak=${zeroStreak}/${exitZero}`);

    const saturatedNow =
      taxonomyVerbs.length > 0 && loopAllVerbsSaturated(db, taxonomyVerbs);
    db.close();

    if (zeroStreak >= exitZero) {
      log(`loop exit: ${exitZero} consecutive iterations with 0 new rows`);
      break;
    }
    if (saturatedNow) {
      log(`loop exit: all taxonomy verbs saturated after iter=${iteration}`);
      break;
    }
  }

  // Soft coverage report (warn only; never blocks promote).
  let coverageReport = null;
  log(`coverage report start`);
  try {
    const covDb = openDb(stagingPath, { readonly: true });
    try {
      const rows = listCommands(covDb);
      coverageReport = buildCoveragePromoteReport(rows, taxonomyVerbs || []);
      const reportPath = writeCoveragePromoteReport(coverageReport);
      if (coverageReport.warn) {
        log(`coverage WARN ${coverageReport.summary} → ${reportPath}`);
      } else {
        log(`coverage ${coverageReport.summary} → ${reportPath}`);
      }
      if (typeof opts.onCoverageReport === 'function') opts.onCoverageReport(coverageReport);
    } finally {
      covDb.close();
    }
  } catch (e) {
    log(`coverage report skipped: ${e?.message || e}`);
  }

  const finalBank = activeEvaluationBank({ kinds: ['golden'], excludeFallbacks: true });
  const finalFloors = evalBankMeetsFloors(finalBank, {
    minTotal: opts.evalMinBankTotal,
    minComposition: opts.evalMinBankComposition,
  });
  if (!finalFloors.ok) {
    log(
      `loop final gate FAIL: bank floors unmet total=${finalFloors.total}/${finalFloors.totalMin} composition=${finalFloors.composition}/${finalFloors.compMin}`,
    );
    return {
      ok: false,
      phase: 'loop',
      iteration,
      message: 'Eval bank floors unmet at loop exit',
      stagingPath,
      bankFloors: finalFloors,
      eval: lastEvalResult,
      coverage: coverageReport,
    };
  }
  if (lastEvalResult && lastEvalResult.ok === false && !opts.continueOnEvalKo) {
    log(`loop final gate FAIL: last eval still KO after floors met`);
    return {
      ok: false,
      phase: 'loop',
      iteration,
      message: 'Eval KO at loop exit',
      stagingPath,
      bankFloors: finalFloors,
      eval: lastEvalResult,
      coverage: coverageReport,
    };
  }

  const prod = opts.prodPath || defaultDbPath();
  log(`promote start staging=${stagingPath} → ${prod}`);
  promoteStagingDb(stagingPath, prod);
  const { finalizePromotedDb } = await import('../seed.js');
  const finalized = finalizePromotedDb(prod);
  log(`promote done commands=${finalized.commands} intents=${finalized.intents} path=${prod}`);
  log(`loop done commands=${finalized.commands} intents=${finalized.intents}`);
  return {
    ok: true,
    phase: 'done',
    iterations: iteration,
    stagingPath,
    prodPath: prod,
    commands: finalized.commands,
    intents: finalized.intents,
    hash: finalized.hash,
    coverage: coverageReport,
    bankFloors: finalFloors,
    eval: lastEvalResult,
  };
}

export { prepareSemanticBlocks };
