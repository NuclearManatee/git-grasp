// @ts-nocheck
import { isValidSkillLevel, SKILL_MAX, SKILL_MIN } from './skills.js';
import {
  ALLOWED_SUBCOMMANDS,
  checkCommand,
  checkExample,
  validateRecipeWithZod,
  validateSearchIntentWithZod,
  validateIntentRowWithZod,
  type ValidateOpts,
  type RecipeValidateOpts,
  type SearchIntentValidateOpts,
  type ValidateResult,
} from '../schemas/index.js';
import { normalizeExample, commandSlug } from './normalizeText.js';

export { normalizeExample, commandSlug };

export function makeRowId(example: unknown, skillLevel: number, intentIndex = 0): string {
  return `${commandSlug(example)}:${skillLevel}:${intentIndex}`;
}

export function validateCommand(command: unknown, opts: ValidateOpts = {}): ValidateResult {
  return checkCommand(command, opts);
}

export function validateExample(example: unknown, opts: ValidateOpts = {}): ValidateResult {
  return checkExample(example, opts);
}

export function validateIntentRow(row: any, opts: ValidateOpts = {}): ValidateResult {
  return validateIntentRowWithZod(row, opts);
}

export function recipeSlugFromTitle(title: unknown): string {
  return commandSlug(title).slice(0, 96) || 'recipe';
}

export function validateRecipe(recipe: unknown, opts: RecipeValidateOpts = {}): ValidateResult {
  return validateRecipeWithZod(recipe, opts);
}

export function validateSearchIntent(
  intent: unknown,
  opts: SearchIntentValidateOpts = {},
): ValidateResult {
  return validateSearchIntentWithZod(intent, opts);
}

export function makeIntentId(recipeId: unknown, skillLevel: number, intentIndex = 0): string {
  return `${recipeId}:${skillLevel}:${intentIndex}`;
}

export { SKILL_MIN, SKILL_MAX, ALLOWED_SUBCOMMANDS, isValidSkillLevel };
