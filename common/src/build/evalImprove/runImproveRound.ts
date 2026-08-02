// @ts-nocheck
/**
 * One Flash→Pro→apply→reintent→re-eval improve round.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openDb } from '../../db/schema.js';
import { llmJsonObject } from '../../lib/llm.js';
import { DEEPSEEK_PRO_MODEL, DEEPSEEK_FLASH_MODEL } from '../../lib/providers.js';
import { renderPrompt } from '../../lib/prompts.js';
import { evalProposalRoundsDir } from '../../lib/paths.js';
import {
  EvalFailureClusterSchema,
  EvalImproveProposalBatchSchema,
} from '../../schemas/evalImprove.js';
import { collectEvalMisses } from './collectMisses.js';
import { splitTrainHoldoutByCommandId } from './splitHoldout.js';
import { validateProposalBatch } from './validateProposals.js';
import {
  readLexiconTrapsFile,
  writeLexiconTrapsFile,
  mergeLexiconTrapProposals,
} from './lexiconTraps.js';
import {
  readVerbFamiliesFile,
  writeVerbFamiliesFile,
  mergeVerbFamilyProposals,
  pruneDistinguishedEvalRoundFamilies,
} from './verbFamilies.js';
import { reexpandIntentsForStaging } from './reexpandIntents.js';
import { loadBank } from '../evalGate.js';

function missPayload(m) {
  return {
    query_text: m?.query?.query_text || '',
    command_id: m?.query?.command_id,
    primary_verb: m?.query?.primary_verb || null,
    via: m?.via || 'miss',
    displayed: (m?.displayed || []).map((h) => ({
      command_id: h.command_id ?? h.recipe_id,
      example: h.example,
      snippet: h.snippet,
    })),
    judge:
      m?.judge || m?.utility != null || m?.reason
        ? {
            utility: m?.judge?.utility ?? m?.utility ?? null,
            reason: m?.judge?.reason ?? m?.reason ?? null,
          }
        : null,
  };
}

function metricsSlice(evalResult) {
  return {
    ok: !!evalResult?.ok,
    okHit: !!evalResult?.okHit,
    okPass: !!evalResult?.okPass,
    passed: Number(evalResult?.passed) || 0,
    hitPassed: Number(evalResult?.hitPassed) || 0,
    total: Number(evalResult?.total) || 0,
    rate: Number(evalResult?.rate) || 0,
    hitRate: Number(evalResult?.hitRate) || 0,
  };
}

/**
 * Compute Hit@display + Pass A rates for a subset of command_ids.
 * @param {object} evalResult
 * @param {Set<number>} commandIds
 */
export function metricsForCommandIds(evalResult, commandIds) {
  const results = (evalResult?.results || []).filter((r) =>
    commandIds.has(Number(r?.query?.command_id)),
  );
  const total = results.length;
  if (!total) {
    return { total: 0, hitPassed: 0, passed: 0, hitRate: 1, rate: 1 };
  }
  const hitPassed = results.filter((r) => r.via === 'hit@display').length;
  const passed = results.filter((r) => r.pass).length;
  return {
    total,
    hitPassed,
    passed,
    hitRate: hitPassed / total,
    rate: passed / total,
  };
}

/**
 * Accept if holdout does not drop and full-bank Pass A gains ≥1 absolute pass
 * (or Hit@display gains if Pass A tied).
 */
export function shouldAcceptImproveRound({ before, after, holdoutBefore, holdoutAfter }) {
  if (!holdoutBefore || !holdoutAfter) {
    // No holdout rows: still require full-bank improvement.
  } else if (holdoutBefore.total > 0) {
    if (holdoutAfter.hitRate + 1e-9 < holdoutBefore.hitRate) return false;
    if (holdoutAfter.rate + 1e-9 < holdoutBefore.rate) return false;
  }
  const passDelta = (after.passed || 0) - (before.passed || 0);
  if (passDelta >= 1) return true;
  if (passDelta === 0) {
    return (after.hitPassed || 0) > (before.hitPassed || 0);
  }
  return false;
}

function writeJson(dir, name, value) {
  writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * @param {{
 *   evalResult: object,
 *   stagingPath: string,
 *   embedder: { embed: Function },
 *   bank: object[],
 *   runBankEval: Function,
 *   taxonomyVerbs?: string[],
 *   llmJsonObject?: Function,
 *   flashModel?: string,
 *   proModel?: string,
 *   trapsPath?: string,
 *   familiesPath?: string,
 *   expandIntents?: Function,
 *   artifactsDir?: string,
 *   log?: (m: string) => void,
 * }} opts
 */
export async function runImproveRound(opts) {
  const log = opts.log || (() => {});
  const call = opts.llmJsonObject || llmJsonObject;
  const flashModel = opts.flashModel || DEEPSEEK_FLASH_MODEL;
  const proModel = opts.proModel || DEEPSEEK_PRO_MODEL;
  const before = opts.evalResult;
  const misses = collectEvalMisses(before);
  if (!misses.length) {
    return {
      ran: false,
      accepted: false,
      reason: 'no_misses',
      evalResult: before,
    };
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const artDir = opts.artifactsDir || path.join(evalProposalRoundsDir(), ts);
  mkdirSync(artDir, { recursive: true });

  const { train, holdout, trainIds, holdoutIds } = splitTrainHoldoutByCommandId(misses);
  writeJson(artDir, 'misses.json', misses.map(missPayload));
  writeJson(artDir, 'split.json', {
    trainIds: [...trainIds],
    holdoutIds: [...holdoutIds],
    trainCount: train.length,
    holdoutCount: holdout.length,
  });

  let summary = { clusters: [] };
  try {
    const { messages } = renderPrompt('build/summarize-eval-failures', {
      failures_json: JSON.stringify(misses.map(missPayload), null, 2),
    });
    summary = await call({
      schema: EvalFailureClusterSchema,
      messages,
      model: flashModel,
    });
  } catch (e) {
    log(`improve summarize failed: ${e?.message || e}`);
    summary = { clusters: [], error: String(e?.message || e) };
  }
  writeJson(artDir, 'summary.json', summary);

  const trapsSnap = readLexiconTrapsFile({ trapsPath: opts.trapsPath });
  let familiesSnap = readVerbFamiliesFile({ familiesPath: opts.familiesPath });
  const goldenBank =
    opts.goldenBank ||
    (typeof opts.loadGoldenBank === 'function'
      ? opts.loadGoldenBank()
      : loadBank('golden.jsonl'));
  const pruned = pruneDistinguishedEvalRoundFamilies(familiesSnap, goldenBank);
  if (pruned.pruned.length) {
    log(
      `improve prune ${pruned.pruned.length} eval_round family(ies) distinguished by goldens`,
    );
    writeVerbFamiliesFile(pruned.file, { familiesPath: opts.familiesPath });
    familiesSnap = pruned.file;
  }
  writeJson(artDir, 'traps-before.json', trapsSnap);
  writeJson(artDir, 'families-before.json', familiesSnap);
  if (pruned.pruned.length) {
    writeJson(artDir, 'families-pruned.json', pruned.pruned);
  }

  let rawBatch = { proposals: [] };
  try {
    const { messages } = renderPrompt('build/propose-eval-rules', {
      taxonomy_verbs: (opts.taxonomyVerbs || []).join('\n'),
      summary_json: JSON.stringify(summary, null, 2),
      train_failures_json: JSON.stringify(train.map(missPayload), null, 2),
      existing_traps_json: JSON.stringify(trapsSnap, null, 2),
      existing_families_json: JSON.stringify(familiesSnap, null, 2),
    });
    rawBatch = await call({
      schema: EvalImproveProposalBatchSchema,
      messages,
      model: proModel,
    });
  } catch (e) {
    log(`improve propose failed: ${e?.message || e}`);
    writeJson(artDir, 'proposals-error.json', { error: String(e?.message || e) });
    return {
      ran: true,
      accepted: false,
      reason: 'propose_failed',
      evalResult: before,
      artifactsDir: artDir,
    };
  }
  writeJson(artDir, 'proposals-raw.json', rawBatch);

  const validated = validateProposalBatch(rawBatch, {
    trainMisses: train,
    taxonomyVerbs: opts.taxonomyVerbs || [],
    goldenBank,
  });
  writeJson(artDir, 'proposals-validated.json', validated);

  if (!validated.proposals.length) {
    log(`improve no valid proposals (errors=${validated.errors.length})`);
    return {
      ran: true,
      accepted: false,
      reason: 'no_valid_proposals',
      errors: validated.errors,
      evalResult: before,
      artifactsDir: artDir,
    };
  }

  const trapProposals = validated.proposals.filter((p) => p.kind === 'lexicon_trap');
  const familyProposals = validated.proposals.filter((p) => p.kind === 'verb_family');

  const mergedTraps = mergeLexiconTrapProposals(trapsSnap, trapProposals);
  const mergedFamilies = mergeVerbFamilyProposals(familiesSnap, familyProposals);
  writeLexiconTrapsFile(mergedTraps, { trapsPath: opts.trapsPath });
  writeVerbFamiliesFile(mergedFamilies, { familiesPath: opts.familiesPath });
  writeJson(artDir, 'traps-after.json', mergedTraps);
  writeJson(artDir, 'families-after.json', mergedFamilies);

  let reexpand = null;
  if (trapProposals.length) {
    log(`improve reexpand intents for ${trapProposals.length} trap(s)`);
    const ownsDb = !opts.db;
    const db = opts.db || openDb(opts.stagingPath);
    try {
      reexpand = await reexpandIntentsForStaging(db, opts.embedder, {
        llmJsonObject: call,
        expandIntents: opts.expandIntents,
        onProgress: (p) => {
          if (p.done % 10 === 0 || p.done === p.total) {
            log(`improve reexpand ${p.done}/${p.total} intents=${p.intentCount}`);
          }
        },
      });
    } finally {
      if (ownsDb) db.close();
    }
    writeJson(artDir, 'reexpand.json', reexpand);
  }

  const holdoutBefore = metricsForCommandIds(before, holdoutIds);
  writeJson(artDir, 'metrics-before.json', {
    full: metricsSlice(before),
    holdout: holdoutBefore,
  });

  log(`improve re-eval bank=${(opts.bank || []).length}`);
  const after = await opts.runBankEval(opts.bank, opts.stagingPath, {
    llmJsonObject: call,
    verbLookup: opts.verbLookup,
    minPassRate: opts.minPassRate,
    minHitAtDisplayRate: opts.minHitAtDisplayRate,
    utilityThreshold: opts.utilityThreshold,
    searchFn: opts.searchFn,
    evalConcurrency: opts.evalConcurrency,
    searchPoolSize: opts.searchPoolSize,
  });

  const holdoutAfter = metricsForCommandIds(after, holdoutIds);
  writeJson(artDir, 'metrics-after.json', {
    full: metricsSlice(after),
    holdout: holdoutAfter,
  });

  const accepted = shouldAcceptImproveRound({
    before: metricsSlice(before),
    after: metricsSlice(after),
    holdoutBefore,
    holdoutAfter,
  });

  if (!accepted) {
    writeLexiconTrapsFile(trapsSnap, { trapsPath: opts.trapsPath });
    writeVerbFamiliesFile(familiesSnap, { familiesPath: opts.familiesPath });
    if (trapProposals.length && opts.embedder) {
      log(`improve reject — restore traps + reexpand`);
      const ownsDb = !opts.db;
      const db = opts.db || openDb(opts.stagingPath);
      try {
        await reexpandIntentsForStaging(db, opts.embedder, {
          llmJsonObject: call,
          expandIntents: opts.expandIntents,
        });
      } finally {
        if (ownsDb) db.close();
      }
    }
    writeJson(artDir, 'decision.json', { accepted: false, reason: 'metrics' });
    log(
      `improve REJECT passA ${before.passed}->${after.passed} hit ${before.hitPassed}->${after.hitPassed}`,
    );
    return {
      ran: true,
      accepted: false,
      reason: 'metrics',
      proposals: validated.proposals,
      errors: validated.errors,
      evalResult: before,
      afterEval: after,
      artifactsDir: artDir,
    };
  }

  writeJson(artDir, 'decision.json', { accepted: true });
  log(
    `improve ACCEPT passA ${before.passed}->${after.passed} hit ${before.hitPassed}->${after.hitPassed}`,
  );
  return {
    ran: true,
    accepted: true,
    reason: 'improved',
    proposals: validated.proposals,
    errors: validated.errors,
    evalResult: after,
    artifactsDir: artDir,
  };
}

/** Snapshot helpers for tests. */
export function readTaxonomySnapshot(opts = {}) {
  return {
    traps: readLexiconTrapsFile({ trapsPath: opts.trapsPath }),
    families: readVerbFamiliesFile({ familiesPath: opts.familiesPath }),
  };
}

export function restoreTaxonomySnapshot(snap, opts = {}) {
  if (snap?.traps) writeLexiconTrapsFile(snap.traps, { trapsPath: opts.trapsPath });
  if (snap?.families) {
    writeVerbFamiliesFile(snap.families, { familiesPath: opts.familiesPath });
  }
}

/** Test helper: apply proposals without LLM. */
export function applyProposalsToTaxonomy(proposals, opts = {}) {
  const trapsSnap = readLexiconTrapsFile({ trapsPath: opts.trapsPath });
  const familiesSnap = readVerbFamiliesFile({ familiesPath: opts.familiesPath });
  const traps = mergeLexiconTrapProposals(trapsSnap, proposals);
  const families = mergeVerbFamilyProposals(familiesSnap, proposals);
  writeLexiconTrapsFile(traps, { trapsPath: opts.trapsPath });
  writeVerbFamiliesFile(families, { familiesPath: opts.familiesPath });
  return { traps, families, previous: { traps: trapsSnap, families: familiesSnap } };
}
