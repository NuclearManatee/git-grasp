// @ts-nocheck
/**
 * Intent matrix builder: Flash draft/rewrite + Pro blind judge.
 * Success = all 16 cells pass in a round. Stop after 10 consecutive failed rounds.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';
import { renderPrompt } from '../lib/prompts.js';
import { llmJsonObject } from '../lib/llm.js';
import { DEEPSEEK_PRO_MODEL } from '../lib/providers.js';
import { intentMatrixPath, intentMatrixEvalDir } from '../lib/paths.js';
import {
  IntentMatrixFileSchema,
  DraftMatrixCellLlmSchema,
  RewriteMatrixCellLlmSchema,
  MatrixJudgeLlmResponseSchema,
  allCellKeys,
  cellKey,
  formatCellGuidance,
} from '../schemas/intentMatrix.js';
import { IntentExpansionLlmResponseSchema } from '../schemas/command.js';
import { filterIntentsForRecipe, primaryStepListing } from './intentFidelity.js';
import { INTENT_EXPAND_CAP } from '../db/constants.js';

export const MATRIX_MAX_FAIL_STREAK = 10;
export const MATRIX_SAMPLES_PER_CELL = 2;

/** Frozen axis language (infrastructure), not catalog content. */
export const SKILL_AXIS_CONTEXT = {
  nontechnical:
    'Users with little or no Git vocabulary. They describe symptoms, panic, or goals in plain language. Avoid assuming knowledge of branches, remotes, or flags.',
  beginner:
    'Users who know basic Git nouns (commit, branch, push) but not workflows. Prefer clear procedural language over jargon.',
  intermediate:
    'Users comfortable with daily porcelain (status, add, commit, pull, push, branch, merge). Practical remotes and conflicts.',
  expert:
    'Users fluent in Git mechanics (reflog, rebase, bisect, index vs worktree). Concise, high-signal phrasing and flag names OK.',
};

export const CATEGORY_AXIS_CONTEXT = {
  goal: 'A desired outcome stated as an objective. Forward-looking and intentional.',
  error_message:
    'Language that mirrors or paraphrases a Git error, warning, or fatal message from the terminal.',
  symptom:
    'Observable broken state without naming the command that fixes it.',
  conversational:
    'Natural, chatty, or incomplete phrasing as typed in a hurry.',
};

/** Minimal recipes for sampling (same fidelity path as ground expansion). */
export const MATRIX_SAMPLE_RECIPES = [
  {
    initial_state: 'git init\necho hi > f.txt\ngit add f.txt\ngit commit -m init',
    command_recipe: {
      commands: [{ command: 'git status', comment: 'show working tree status' }],
    },
  },
  {
    initial_state:
      'git init\necho a > f.txt\ngit add f.txt\ngit commit -m a\ngit checkout -b other\necho b > f.txt\ngit add f.txt\ngit commit -m b\ngit checkout master\necho c > f.txt\ngit add f.txt\ngit commit -m c',
    command_recipe: {
      commands: [{ command: 'git merge other', comment: 'merge divergent branch' }],
    },
  },
  {
    initial_state: 'git init\necho hi > f.txt\ngit add f.txt\ngit commit -m init',
    command_recipe: {
      commands: [{ command: 'git commit --amend -m fixed', comment: 'amend last commit message' }],
    },
  },
];

/** @deprecated use MATRIX_SAMPLE_RECIPES */
export const MATRIX_SAMPLE_RECIPE = MATRIX_SAMPLE_RECIPES[0];

function log(...args) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[matrix ${ts}]`, ...args);
}

/**
 * @param {{ skill_level: string, intent_category: string }} cellMeta
 * @param {{ llmJsonObject?: typeof llmJsonObject }} [opts]
 */
export async function draftMatrixCell(cellMeta, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const { messages } = renderPrompt('taxonomy/draft-matrix-cell', {
    skill_level: cellMeta.skill_level,
    intent_category: cellMeta.intent_category,
    skill_context: SKILL_AXIS_CONTEXT[cellMeta.skill_level],
    category_context: CATEGORY_AXIS_CONTEXT[cellMeta.intent_category],
  });
  const drafted = await call({ schema: DraftMatrixCellLlmSchema, messages });
  return {
    skill_level: cellMeta.skill_level,
    intent_category: cellMeta.intent_category,
    description: drafted.description,
    dos: drafted.dos,
    donts: drafted.donts,
  };
}

/**
 * @param {object} cell
 * @param {string[]} judgeReasons
 * @param {{ llmJsonObject?: typeof llmJsonObject }} [opts]
 */
export async function rewriteMatrixCell(cell, judgeReasons, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const { messages } = renderPrompt('taxonomy/rewrite-matrix-cell', {
    skill_level: cell.skill_level,
    intent_category: cell.intent_category,
    previous_cell: formatCellGuidance(cell, { includeLabels: true }),
    judge_reasons: (judgeReasons || []).map((r) => `- ${r}`).join('\n'),
  });
  const rewritten = await call({ schema: RewriteMatrixCellLlmSchema, messages });
  return {
    skill_level: cell.skill_level,
    intent_category: cell.intent_category,
    description: rewritten.description,
    dos: rewritten.dos,
    donts: rewritten.donts,
  };
}

/**
 * Sample intents for one cell via dedicated prompt + same filterIntentsForRecipe as ground.
 * Tries multiple recipes until enough samples. Retags labels to the target cell (prompt is cell-scoped).
 * @param {object} cell
 * @param {{ llmJsonObject?: typeof llmJsonObject, recipes?: object[], cap?: number }} [opts]
 */
export async function sampleIntentsForCell(cell, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const recipes = opts.recipes || MATRIX_SAMPLE_RECIPES;
  const seen = new Set();
  /** @type {{ skill_level: string, intent_category: string, intent_text: string }[]} */
  const out = [];

  for (const recipe of recipes) {
    if (out.length >= MATRIX_SAMPLES_PER_CELL) break;
    const { primary, listing } = primaryStepListing(recipe);
    const { messages } = renderPrompt('taxonomy/sample-cell-intents', {
      skill_level: cell.skill_level,
      intent_category: cell.intent_category,
      cell_guidance: formatCellGuidance(cell, { includeLabels: true }),
      primary,
      listing,
      initial_state: recipe.initial_state,
    });
    const result = await call({
      schema: IntentExpansionLlmResponseSchema,
      messages,
    });
    const filtered = filterIntentsForRecipe(recipe, result.intents, {
      cap: opts.cap ?? INTENT_EXPAND_CAP,
    });
    for (const intent of filtered) {
      const text = String(intent.intent_text || '').trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      // Prompt is cell-scoped; normalize labels so a mis-tagged but valid text still counts.
      out.push({
        skill_level: cell.skill_level,
        intent_category: cell.intent_category,
        intent_text: text,
      });
      if (out.length >= MATRIX_SAMPLES_PER_CELL * 2) break;
    }
  }
  return out;
}

/**
 * Blind Pro judge over all cells. Labels are not sent — only opaque cell_key + guidance + samples.
 * @param {{ cell: object, samples: { intent_text: string }[], key: string }[]} entries
 * @param {{ llmJsonObject?: typeof llmJsonObject, model?: string }} [opts]
 */
export async function judgeMatrixSamples(entries, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const model = opts.model || DEEPSEEK_PRO_MODEL;
  const cells_block = entries
    .map((e, idx) => {
      const guidance = formatCellGuidance(e.cell, { includeLabels: false });
      const samples = (e.samples || [])
        .map((s, i) => `${i + 1}. ${s.intent_text}`)
        .join('\n');
      return [
        `### Cell ${idx + 1}`,
        `cell_key: ${e.key}`,
        '',
        'Guidance:',
        guidance,
        '',
        'Sample queries:',
        samples || '(no samples)',
      ].join('\n');
    })
    .join('\n\n');

  const { messages } = renderPrompt('taxonomy/judge-matrix-samples', { cells_block });
  const result = await call({
    schema: MatrixJudgeLlmResponseSchema,
    messages,
    model,
  });

  /** @type {Map<string, { pass: boolean, reasons: string[] }>} */
  const byKey = new Map();
  for (const c of result.cells) {
    byKey.set(c.cell_key, { pass: c.pass, reasons: c.reasons });
  }
  // Fail-closed: missing keys fail
  for (const e of entries) {
    if (!byKey.has(e.key)) {
      byKey.set(e.key, {
        pass: false,
        reasons: ['Judge omitted this cell_key'],
      });
    }
  }
  return byKey;
}

/**
 * @param {{
 *   llmJsonObject?: typeof llmJsonObject,
 *   outPath?: string,
 *   reportDir?: string,
 *   concurrency?: number,
 *   maxFailStreak?: number,
 *   fresh?: boolean,
 * }} [opts]
 */
export async function runIntentMatrixBuild(opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const concurrency = opts.concurrency ?? 8;
  const maxFailStreak = opts.maxFailStreak ?? MATRIX_MAX_FAIL_STREAK;
  const outPath = opts.outPath || intentMatrixPath();
  const reportDir = opts.reportDir || intentMatrixEvalDir();
  mkdirSync(reportDir, { recursive: true });
  mkdirSync(path.dirname(outPath), { recursive: true });

  const limit = pLimit(concurrency);
  const keys = allCellKeys();

  log(`draft start cells=${keys.length} concurrency=${concurrency}`);
  let cells = await Promise.all(
    keys.map((k) =>
      limit(async () => {
        const cell = await draftMatrixCell(k, { llmJsonObject: call });
        log(`drafted ${k.key}`);
        return cell;
      }),
    ),
  );

  let failStreak = 0;
  let round = 0;
  /** @type {object[]} */
  const roundReports = [];

  while (failStreak < maxFailStreak) {
    round += 1;
    log(`round ${round} sample start`);

    const samplesByKey = new Map();
    await Promise.all(
      cells.map((cell) =>
        limit(async () => {
          const key = cellKey(cell.skill_level, cell.intent_category);
          try {
            const samples = await sampleIntentsForCell(cell, { llmJsonObject: call });
            samplesByKey.set(key, samples);
            log(`sample ${key} n=${samples.length}`);
          } catch (e) {
            samplesByKey.set(key, []);
            log(`sample ${key} ERROR ${e?.message || e}`);
          }
        }),
      ),
    );

    // Cells with zero samples after filter fail closed before Pro spend
    const preFail = [];
    for (const cell of cells) {
      const key = cellKey(cell.skill_level, cell.intent_category);
      const samples = samplesByKey.get(key) || [];
      if (samples.length === 0) {
        preFail.push({
          key,
          pass: false,
          reasons: ['No usable samples after fidelity filter'],
        });
      }
    }

    const judgeEntries = cells.map((cell) => {
      const key = cellKey(cell.skill_level, cell.intent_category);
      return { cell, key, samples: samplesByKey.get(key) || [] };
    });

    log(`round ${round} judge start (Pro)`);
    const judged = await judgeMatrixSamples(judgeEntries, {
      llmJsonObject: call,
      model: DEEPSEEK_PRO_MODEL,
    });

    for (const pf of preFail) {
      judged.set(pf.key, { pass: false, reasons: pf.reasons });
    }

    const results = keys.map(({ key }) => {
      const j = judged.get(key) || { pass: false, reasons: ['missing'] };
      return { key, pass: !!j.pass, reasons: j.reasons || [] };
    });
    const failed = results.filter((r) => !r.pass);
    const allPass = failed.length === 0;

    const report = {
      round,
      at: new Date().toISOString(),
      all_pass: allPass,
      pass_count: results.filter((r) => r.pass).length,
      fail_count: failed.length,
      fail_streak_after: allPass ? 0 : failStreak + 1,
      results,
      samples: Object.fromEntries(
        [...samplesByKey.entries()].map(([k, v]) => [
          k,
          v.map((i) => i.intent_text),
        ]),
      ),
    };
    roundReports.push(report);
    writeFileSync(
      path.join(reportDir, `round-${String(round).padStart(2, '0')}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    log(
      `round ${round} pass=${report.pass_count}/16 fail=${report.fail_count} allPass=${allPass}`,
    );

    if (allPass) {
      const file = IntentMatrixFileSchema.parse({
        version: 1,
        generated_at: new Date().toISOString(),
        cells,
      });
      writeFileSync(outPath, `${JSON.stringify(file, null, 2)}\n`);
      writeFileSync(
        path.join(reportDir, 'summary.json'),
        `${JSON.stringify(
          {
            ok: true,
            rounds: round,
            fail_streak_max: failStreak,
            outPath,
          },
          null,
          2,
        )}\n`,
      );
      log(`SUCCESS wrote ${outPath}`);
      return { ok: true, rounds: round, outPath, cells: file.cells, reports: roundReports };
    }

    failStreak += 1;
    if (failStreak >= maxFailStreak) break;

    log(`round ${round} rewrite failing=${failed.length} streak=${failStreak}`);
    const failSet = new Set(failed.map((f) => f.key));
    const reasonByKey = new Map(failed.map((f) => [f.key, f.reasons]));
    cells = await Promise.all(
      cells.map((cell) =>
        limit(async () => {
          const key = cellKey(cell.skill_level, cell.intent_category);
          if (!failSet.has(key)) return cell;
          const next = await rewriteMatrixCell(cell, reasonByKey.get(key) || [], {
            llmJsonObject: call,
          });
          log(`rewrote ${key}`);
          return next;
        }),
      ),
    );
  }

  writeFileSync(
    path.join(reportDir, 'summary.json'),
    `${JSON.stringify(
      {
        ok: false,
        rounds: round,
        fail_streak: failStreak,
        max_fail_streak: maxFailStreak,
        outPath,
      },
      null,
      2,
    )}\n`,
  );
  log(`STOP after ${failStreak} consecutive failed rounds (max=${maxFailStreak})`);
  return {
    ok: false,
    rounds: round,
    failStreak,
    outPath,
    reports: roundReports,
  };
}
