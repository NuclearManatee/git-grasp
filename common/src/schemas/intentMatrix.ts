// @ts-nocheck
import { z } from 'zod';
import { SkillLevelTextSchema, IntentCategorySchema } from './command.js';

export const SKILL_LEVELS = /** @type {const} */ ([
  'nontechnical',
  'beginner',
  'intermediate',
  'expert',
]);

export const INTENT_CATEGORIES = /** @type {const} */ ([
  'goal',
  'error_message',
  'symptom',
  'conversational',
]);

export const IntentMatrixCellSchema = z.object({
  skill_level: SkillLevelTextSchema,
  intent_category: IntentCategorySchema,
  description: z.string().min(1).max(2000),
  dos: z.array(z.string().min(1)).min(1).max(12),
  donts: z.array(z.string().min(1)).min(1).max(12),
});

export const IntentMatrixFileSchema = z.object({
  version: z.number().int().positive().default(1),
  generated_at: z.string().optional(),
  cells: z.array(IntentMatrixCellSchema).length(16),
}).superRefine((file, ctx) => {
  const seen = new Set();
  for (const cell of file.cells) {
    const key = `${cell.skill_level}::${cell.intent_category}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate cell ${key}`,
      });
    }
    seen.add(key);
  }
  for (const skill of SKILL_LEVELS) {
    for (const category of INTENT_CATEGORIES) {
      const key = `${skill}::${category}`;
      if (!seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `Missing cell ${key}`,
        });
      }
    }
  }
});

export const DraftMatrixCellLlmSchema = z.object({
  description: z.string().min(1).max(2000),
  dos: z.array(z.string().min(1)).min(1).max(12),
  donts: z.array(z.string().min(1)).min(1).max(12),
});

export const RewriteMatrixCellLlmSchema = DraftMatrixCellLlmSchema;

export const MatrixJudgeCellResultSchema = z.object({
  cell_key: z.string().min(1),
  pass: z.boolean(),
  reasons: z.array(z.string().min(1)).min(1).max(12),
});

export const MatrixJudgeLlmResponseSchema = z.object({
  cells: z.array(MatrixJudgeCellResultSchema).min(1).max(16),
});

/** @typedef {z.infer<typeof IntentMatrixCellSchema>} IntentMatrixCell */
/** @typedef {z.infer<typeof IntentMatrixFileSchema>} IntentMatrixFile */

export function cellKey(skill, category) {
  return `${skill}::${category}`;
}

export function allCellKeys() {
  /** @type {{ skill_level: string, intent_category: string, key: string }[]} */
  const out = [];
  for (const skill_level of SKILL_LEVELS) {
    for (const intent_category of INTENT_CATEGORIES) {
      out.push({
        skill_level,
        intent_category,
        key: cellKey(skill_level, intent_category),
      });
    }
  }
  return out;
}

/**
 * @param {IntentMatrixFile} matrix
 * @param {string} skill
 * @param {string} category
 */
export function getMatrixCell(matrix, skill, category) {
  return matrix.cells.find(
    (c) => c.skill_level === skill && c.intent_category === category,
  ) || null;
}

/**
 * Format the full matrix for expand-intents injection.
 * @param {IntentMatrixFile} matrix
 */
export function formatIntentMatrixForPrompt(matrix) {
  const lines = ['# Intent matrix (skill × category)', ''];
  for (const { skill_level, intent_category } of allCellKeys()) {
    const cell = getMatrixCell(matrix, skill_level, intent_category);
    if (!cell) continue;
    lines.push(`## ${skill_level} × ${intent_category}`);
    lines.push(cell.description.trim());
    lines.push('');
    lines.push('Dos:');
    for (const d of cell.dos) lines.push(`- ${d}`);
    lines.push('');
    lines.push("Don'ts:");
    for (const d of cell.donts) lines.push(`- ${d}`);
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

/**
 * Format one cell's guidance without axis labels (for blind judge rubrics / focused sample).
 * @param {IntentMatrixCell} cell
 * @param {{ includeLabels?: boolean }} [opts]
 */
export function formatCellGuidance(cell, opts = {}) {
  const includeLabels = opts.includeLabels !== false;
  const lines = [];
  if (includeLabels) {
    lines.push(`## ${cell.skill_level} × ${cell.intent_category}`);
  }
  lines.push(cell.description.trim());
  lines.push('');
  lines.push('Dos:');
  for (const d of cell.dos) lines.push(`- ${d}`);
  lines.push('');
  lines.push("Don'ts:");
  for (const d of cell.donts) lines.push(`- ${d}`);
  return lines.join('\n').trim();
}
