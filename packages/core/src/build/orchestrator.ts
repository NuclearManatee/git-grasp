/**
 * Build+Eval orchestrator: prepare → ground → interactive loop with staging.
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
  canonicalPinsPath,
} from '../lib/paths.js';
import {
  BUILD_CONCURRENCY,
  LOOP_EXIT_ZERO_STREAK,
  LOOP_MAX_BATCH,
  MAX_COMMANDS,
  MAX_INTENTS,
  EVAL_MIN_PASS_RATE,
  EVAL_MIN_HIT_AT3_RATE,
  EVAL_JUDGE_CONFIDENCE_THRESHOLD,
  EVAL_SEARCH_POOL_SIZE,
  META_BUILD_LOOP_ITERATION,
  META_BUILD_LOOP_ZERO_STREAK,
  META_BUILD_LOOP_MAX_ITERATIONS,
} from '../db/constants.js';
import { prepareSemanticBlocks, readSemanticBlocks, loadGitCommandTaxonomy } from './prepare.js';
import { generateAndValidate } from './validate.js';
import { expandIntentsForRecipe, evolveByKind } from './generate.js';
import { dedupDecision, findCommandByFingerprint, recipeFingerprint } from './dedup.js';
import {
  loadCanonicalPinsFile,
  validatePinForGround,
  emptyPinGroundStats,
  bumpSkip,
} from './pinGround.js';
import { CRITICAL_PIN_ROLES } from '../schemas/taxonomyPins.js';
import { createWriterQueue } from './writerQueue.js';
import {
  appendBank,
  evaluateBank,
  activeEvaluationBank,
  generateGoldenQuery,
  expandQueries,
  scrambleQuery,
  tagGolden,
  primaryVerbFromRecipe,
  formatEvalReport,
  formatJudgeVote,
  appendEvolveGolden,
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
  writePinNlBank,
  isFallbackGoldenQuery,
} from './evalGate.js';
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
 * MiniLM embed is mutex-serialized; each RO conn has its own mutex for sqlite.
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
  const minHitAt3Rate = opts.minHitAt3Rate ?? EVAL_MIN_HIT_AT3_RATE;
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
        `eval skipJudge hitRate=${(info.hitRate ?? 0).toFixed(2)} < minHitAt3=${info.minHitAt3Rate}`,
      );
    });

  log(
    `eval criteria hit@3>=${minHitAt3Rate} passA>=${minPassRate} judgeConf>${EVAL_JUDGE_CONFIDENCE_THRESHOLD}`,
  );
  log(`eval judgePrompt ${JUDGE_SYSTEM_PROMPT.replace(/\s+/g, ' ').trim()}`);

  const evalOpts = {
    llmJsonObject: opts.llmJsonObject,
    minPassRate,
    minHitAt3Rate,
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
  // Only wipe ephemeral ground/loop artifacts — never Step −1 prepare output.
  const dir = buildCacheDir();
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  log(`wiped build cache → ${dir} (Step −1 prepare kept)`);
}

export function wipeEvalBanks() {
  const evalDir = evalDataDir();
  if (existsSync(evalDir)) {
    rmSync(evalDir, { recursive: true, force: true });
    log(`wiped eval banks → ${evalDir}`);
  }
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
      // Merge any new intents onto survivor.
      const intents = accepted.intents || [];
      if (intents.length) {
        const rawDb = d._db ?? d;
        const existingTexts = new Set(
          rawDb
            .prepare(`SELECT intent_text FROM intents WHERE command_id = ?`)
            .all(existing.row_id)
            .map((r) =>
              String(r.intent_text || '')
                .toLowerCase()
                .trim(),
            ),
        );
        for (const intent of intents) {
          const key = String(intent.intent_text || '')
            .toLowerCase()
            .trim();
          if (!key || existingTexts.has(key)) continue;
          existingTexts.add(key);
          const emb = await embedder.embed(intent.intent_text);
          insertIntentWithEmbedding(d, {
            command_id: existing.row_id,
            skill_level: intent.skill_level,
            intent_category: intent.intent_category,
            intent_text: intent.intent_text,
            embedding: emb,
          });
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
    });
    const intents = accepted.intents || [];
    for (const intent of intents) {
      const emb = await embedder.embed(intent.intent_text);
      insertIntentWithEmbedding(d, {
        command_id: row_id,
        skill_level: intent.skill_level,
        intent_category: intent.intent_category,
        intent_text: intent.intent_text,
        embedding: emb,
      });
    }
    const cEmb = await embedder.embed(
      commandEmbedText({ ...accepted, command_recipe: accepted.command_recipe }),
    );
    insertCommandEmbedding(d, row_id, cEmb);
    return { inserted: true, row_id, reason: decision };
  });
}

/**
 * Ground steps 1–4 over semantic_blocks into staging.
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

  const concurrency = opts.concurrency ?? BUILD_CONCURRENCY;
  log(`ground start groups=${groups.length} concurrency=${concurrency}`);
  const limit = pLimit(concurrency);
  const inserted = [];
  const errors = [];
  let done = 0;

  await Promise.all(
    groups.map((group, idx) =>
      limit(async () => {
        if (countCommands(db) >= MAX_COMMANDS || countIntents(db) >= MAX_INTENTS) return;
        const label = group.command || `group-${idx}`;
        try {
          log(`ground[${idx + 1}/${groups.length}] generate+validate "${label}"`);
          const validated = await generateAndValidate(group, {
            workerId: idx % concurrency,
            jobId: `ground-${idx}`,
            llmJsonObject: opts.llmJsonObject,
            generate: opts.generate,
            validate: opts.validate,
          });
          if (!validated.ok) {
            errors.push({ idx, reason: validated.reason });
            log(`ground[${idx + 1}/${groups.length}] FAIL validate reason=${validated.reason}`);
            return;
          }
          log(`ground[${idx + 1}/${groups.length}] expand intents`);
          const intents = opts.expandIntents
            ? await opts.expandIntents(validated)
            : await expandIntentsForRecipe(validated, { llmJsonObject: opts.llmJsonObject });
          const list = Array.isArray(intents) ? intents : [];
          const persisted = await persistAccepted(
            db,
            writer,
            { ...validated, intents: list },
            embedder,
          );
          if (persisted.inserted) {
            inserted.push(persisted.row_id);
            log(`ground[${idx + 1}/${groups.length}] INSERT row_id=${persisted.row_id} intents=${list.length}`);
            if (!opts.skipEvalBanks) {
              const row = getCommand(db, persisted.row_id);
              const goldenRaw = opts.generateGolden
                ? await opts.generateGolden(row, persisted.row_id)
                : await generateGoldenQuery(row, persisted.row_id, {
                    llmJsonObject: opts.llmJsonObject,
                    priorQueries: loadBank('golden.jsonl').map((r) => r.query_text),
                  });
              const golden = tagGolden(goldenRaw, {
                mutation_kind: 'ground',
                primary_verb: primaryVerbFromRecipe(row),
              });
              appendBank('golden.jsonl', [golden]);
              const extended = opts.expandQueries
                ? await opts.expandQueries(golden, row)
                : await expandQueries(golden, row, { llmJsonObject: opts.llmJsonObject });
              appendBank('extended.jsonl', extended);
              appendBank(
                'scrambled.jsonl',
                extended.map((e, i) => ({
                  query_text: scrambleQuery(e.query_text, persisted.row_id + i),
                  command_id: persisted.row_id,
                  kind: 'scrambled',
                })),
              );
              log(`ground[${idx + 1}/${groups.length}] eval banks +golden +${extended.length} extended`);
            }
          } else {
            log(`ground[${idx + 1}/${groups.length}] DEDUP keep existing row_id=${persisted.row_id}`);
          }
        } catch (e) {
          errors.push({ idx, reason: e?.message || String(e) });
          log(`ground[${idx + 1}/${groups.length}] ERROR ${e?.message || e}`);
        } finally {
          done += 1;
          if (done % 5 === 0 || done === groups.length) {
            log(`ground progress ${done}/${groups.length} inserted=${inserted.length} errors=${errors.length}`);
          }
        }
      }),
    ),
  );

  // Thin wire-up: inject canonical pins after vanilla ground groups.
  const pinStats = emptyPinGroundStats();
  const pinsPath = opts.pinsPath || canonicalPinsPath();
  let pins = [];
  try {
    pins = opts.skipPins ? [] : loadCanonicalPinsFile(pinsPath);
  } catch (e) {
    log(`pins load ERROR ${e?.message || e}`);
  }
  pinStats.pins_total = pins.length;
  if (pins.length) {
    const taxonomyVerbs = new Set(
      opts.taxonomyVerbs ||
        loadGitCommandTaxonomy().commands.map((c) => c.command),
    );
    log(`pins ground start count=${pins.length} from ${pinsPath}`);
    const pinLimit = pLimit(Math.min(8, concurrency));
    const pinGoalToRow = new Map();
    await Promise.all(
      pins.map((pin, pIdx) =>
        pinLimit(async () => {
          if (countCommands(db) >= MAX_COMMANDS || countIntents(db) >= MAX_INTENTS) return;
          pinStats.pins_attempted += 1;
          try {
            const validated = validatePinForGround(pin, {
              taxonomyVerbs,
              workerId: pIdx % concurrency,
              jobId: `pin-${pin.goal_id}`,
              validate: opts.validate,
            });
            if (!validated.ok) {
              bumpSkip(pinStats, validated.reason);
              log(`pins[${pIdx + 1}/${pins.length}] SKIP ${pin.goal_id} reason=${validated.reason}`);
              return;
            }
            let intents = validated.intents;
            if (!opts.skipPinIntentExpand) {
              try {
                const expanded = await expandIntentsForRecipe(
                  {
                    initial_state: validated.candidate.initial_state,
                    command_recipe: validated.candidate.command_recipe,
                  },
                  { llmJsonObject: opts.llmJsonObject },
                );
                const seen = new Set(intents.map((i) => i.intent_text.toLowerCase().trim()));
                for (const e of expanded || []) {
                  const key = String(e.intent_text || '')
                    .toLowerCase()
                    .trim();
                  if (!key || seen.has(key)) continue;
                  seen.add(key);
                  intents.push(e);
                }
              } catch (e) {
                log(`pins[${pIdx + 1}/${pins.length}] intent expand warn: ${e?.message || e}`);
              }
            }
            const persisted = await persistAccepted(
              db,
              writer,
              {
                initial_state: validated.candidate.initial_state,
                command_recipe: validated.candidate.command_recipe,
                risk: validated.candidate.risk,
                initial_state_physical_hash: validated.initial_state_physical_hash,
                final_state_physical_hash: validated.final_state_physical_hash,
                intents,
                mutation_kind: null,
                parent_row_id: null,
              },
              embedder,
            );
            pinGoalToRow.set(pin.goal_id, persisted.row_id);
            if (persisted.inserted) {
              pinStats.pins_inserted += 1;
              for (const r of pin.goal_roles || []) pinStats.accepted_roles.push(r);
              inserted.push(persisted.row_id);
              log(
                `pins[${pIdx + 1}/${pins.length}] INSERT ${pin.goal_id} row_id=${persisted.row_id} intents=${intents.length}`,
              );
              if (!opts.skipEvalBanks) {
                const row = getCommand(db, persisted.row_id);
                const seedQ = validated.pin.seed_intents[0];
                const golden = tagGolden(
                  {
                    query_text: seedQ || `goal ${pin.goal_id}`,
                    command_id: persisted.row_id,
                    kind: 'golden',
                  },
                  {
                    mutation_kind: 'ground',
                    primary_verb: primaryVerbFromRecipe(row),
                  },
                );
                appendBank('golden.jsonl', [golden]);
              }
            } else {
              pinStats.pins_dedup_merged += 1;
              for (const r of pin.goal_roles || []) pinStats.accepted_roles.push(r);
              const rawDb = db._db ?? db;
              const existingTexts = new Set(
                rawDb
                  .prepare(`SELECT intent_text FROM intents WHERE command_id = ?`)
                  .all(persisted.row_id)
                  .map((r) =>
                    String(r.intent_text || '')
                      .toLowerCase()
                      .trim(),
                  ),
              );
              let added = 0;
              await writer.run(async (d) => {
                for (const intent of validated.intents) {
                  const key = intent.intent_text.toLowerCase().trim();
                  if (!key || existingTexts.has(key)) continue;
                  existingTexts.add(key);
                  const emb = await embedder.embed(intent.intent_text);
                  insertIntentWithEmbedding(d, {
                    command_id: persisted.row_id,
                    skill_level: intent.skill_level,
                    intent_category: intent.intent_category,
                    intent_text: intent.intent_text,
                    embedding: emb,
                  });
                  added += 1;
                }
              });
              log(
                `pins[${pIdx + 1}/${pins.length}] DEDUP merge ${pin.goal_id} → row_id=${persisted.row_id} +${added} seed intents`,
              );
            }
          } catch (e) {
            bumpSkip(pinStats, 'error');
            log(`pins[${pIdx + 1}/${pins.length}] ERROR ${pin.goal_id}: ${e?.message || e}`);
          }
        }),
      ),
    );
    const pinNlCount = writePinNlBank(pins, pinGoalToRow);
    log(`pins NL bank wrote ${pinNlCount} queries`);
    log(
      `pins ground done inserted=${pinStats.pins_inserted} merged=${pinStats.pins_dedup_merged} skipped=${pinStats.pins_skipped} reasons=${JSON.stringify(pinStats.skip_reasons)}`,
    );

    const coveredRoles = new Set(pinStats.accepted_roles || []);
    const missingCritical = [...CRITICAL_PIN_ROLES].filter((r) => !coveredRoles.has(r));
    if (missingCritical.length && !opts.skipPinRoleGate) {
      const cmdCount = countCommands(db);
      log(`pins ROLE GATE FAIL missing=${missingCritical.join(',')}`);
      db.close();
      return {
        ok: false,
        inserted: inserted.length,
        errors: [
          ...errors,
          { idx: -1, reason: `pin_role_gate:${missingCritical.join(',')}` },
        ],
        stagingPath: resolvedStaging,
        eval: { ok: false, skipped: true },
        commands: cmdCount,
        pins: { ...pinStats, critical_missing: missingCritical },
      };
    }
    if (missingCritical.length) {
      log(`pins ROLE GATE WARN (skipped) missing=${missingCritical.join(',')}`);
    }
  } else {
    log(`pins ground skip (no pins at ${pinsPath})`);
  }

  let evalResult = { ok: true, skipped: true };
  if (!opts.skipEval && inserted.length) {
    // Hard gate on golden only (exclude fallback "how do I use git X").
    const bank = activeEvaluationBank({ kinds: ['golden'], excludeFallbacks: true });
    const minPassRate = opts.minPassRate ?? EVAL_MIN_PASS_RATE;
    const minHitAt3Rate = opts.minHitAt3Rate ?? EVAL_MIN_HIT_AT3_RATE;
    log(
      `ground eval bank size=${bank.length} minHitAt3=${minHitAt3Rate} minPassRate=${minPassRate}`,
    );
    const verbLookup = verbLookupFromRows(listCommands(db));
    evalResult = await runBankEval(bank, resolvedStaging, {
      llmJsonObject: opts.llmJsonObject,
      minPassRate,
      minHitAt3Rate,
      verbLookup,
      searchFn: opts.searchFn,
      evalConcurrency: opts.evalConcurrency,
      onProgress: opts.onEvalProgress,
      onJudgeVote: opts.onJudgeVote,
    });
    log(formatEvalReport(evalResult));
    if (typeof opts.onEvalReport === 'function') opts.onEvalReport(evalResult, { phase: 'ground' });

    if (!opts.skipPinNlEval) {
      const pinBank = activeEvaluationBank({ kinds: ['pin_nl'], excludeFallbacks: false });
      if (pinBank.length) {
        log(`ground pin-nl eval bank size=${pinBank.length}`);
        const pinNl = await runBankEval(pinBank, resolvedStaging, {
          llmJsonObject: opts.llmJsonObject,
          minPassRate: minHitAt3Rate,
          minHitAt3Rate,
          verbLookup,
          searchFn: opts.searchFn,
          evalConcurrency: opts.evalConcurrency,
        });
        log(
          `ground pin-nl ok=${pinNl.ok} hit@3=${(pinNl.hitRate ?? 0).toFixed(2)} passA=${(pinNl.rate ?? 0).toFixed(2)}`,
        );
        if (pinNl.ok === false) {
          evalResult = { ...evalResult, ok: false, pinNl };
        } else {
          evalResult = { ...evalResult, pinNl };
        }
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
  log(`ground done ok=${ok} commands=${cmdCount} intents=${intentCount} inserted=${inserted.length} errors=${errors.length}`);
  return {
    ok,
    inserted: inserted.length,
    errors,
    stagingPath: resolvedStaging,
    eval: evalResult,
    commands: cmdCount,
    pins: pinStats,
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
        message: 'Eval KO after ground step — analyze post-mortems before continuing',
        ko: ground.eval,
      };
    }
  }

  const stagingPath = ground.stagingPath || buildStagingDbPath();
  if (!existsSync(stagingPath)) {
    return {
      ok: false,
      phase: 'loop',
      message: `Missing staging DB at ${stagingPath} — run build:ground first`,
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
            const tIntents = Date.now();
            const intents = opts.expandIntents
              ? await opts.expandIntents(validated)
              : await expandIntentsForRecipe(validated, {
                  llmJsonObject: opts.llmJsonObject,
                });
            evolveTiming.intentsMs += Date.now() - tIntents;
            const list = Array.isArray(intents) ? intents : [];
            const tPersist = Date.now();
            const persisted = await persistAccepted(
              db,
              writer,
              {
                ...validated,
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
              // One golden per accepted evolve insert (no cap). Extended/scrambled stay ground-only.
              if (!opts.skipEvalBanks) {
                const childRow =
                  getCommand(db, persisted.row_id) ||
                  ({
                    ...validated,
                    row_id: persisted.row_id,
                    mutation_kind,
                  } as any);
                const tGolden = Date.now();
                const goldenRaw = opts.generateGolden
                  ? await opts.generateGolden(childRow, persisted.row_id)
                  : await generateGoldenQuery(childRow, persisted.row_id, {
                      llmJsonObject: opts.llmJsonObject,
                      priorQueries: loadBank('golden.jsonl').map((r) => r.query_text),
                    });
                evolveTiming.goldenMs += Date.now() - tGolden;
                appendEvolveGolden(
                  { ...childRow, mutation_kind },
                  goldenRaw,
                );
                log(`loop iter=${iteration} +golden child=${persisted.row_id} kind=${mutation_kind}`);
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
    const minHitAt3Rate = opts.minHitAt3Rate ?? EVAL_MIN_HIT_AT3_RATE;
    log(
      `loop iter=${iteration} evolve done ok=${evolvedOk} fail=${evolvedFail} newUnique=${newUnique}; eval bank=${bank.length} minHitAt3=${minHitAt3Rate} minPassRate=${minPassRate}`,
    );
    const verbLookup = verbLookupFromRows(listCommands(db));
    const evalResult = await runBankEval(bank, stagingPath, {
      llmJsonObject: opts.llmJsonObject,
      minPassRate,
      minHitAt3Rate,
      verbLookup,
      searchFn: opts.searchFn,
      evalConcurrency: opts.evalConcurrency,
      onProgress: opts.onEvalProgress,
      onJudgeVote: opts.onJudgeVote,
    });
    log(formatEvalReport(evalResult));
    if (typeof opts.onEvalReport === 'function') {
      opts.onEvalReport(evalResult, { phase: 'loop', iteration });
    }

    if (!evalResult.ok) {
      // Keep last *successful* iteration on the dataset so relaunch retries this one.
      persistLoopProgress(db, {
        iteration: Math.max(0, iteration - 1),
        zeroStreak,
        maxIterations: maxIter,
      });
      db.close();
      log(`loop KO at iter=${iteration} — stopping (resume will retry from ${Math.max(0, iteration - 1)})`);
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
          minHitAt3Rate: evalResult.minHitAt3Rate,
          verbRate: evalResult.verbRate,
          byMutationKind: evalResult.byMutationKind,
          judgeSummary: evalResult.judgeSummary,
        },
        message: 'Eval KO — analyze and propose fix',
        stagingPath,
      };
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
  };
}

export { prepareSemanticBlocks };
