import { describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SchemaParseError, parseJson, readJsonFile, readJsonl } from '../../common/src/schemas/io.ts';
import {
  checkCommand,
  checkExample,
  gitCommandSchema,
  gitExampleSchema,
} from '../../common/src/schemas/gitCommand.ts';
import {
  validateRecipeWithZod,
  ProductRecipeSchema,
  MeaningfulnessJudgeLlmSchema,
  RecipeSchema,
} from '../../common/src/schemas/recipe.ts';
import {
  validateSearchIntentWithZod,
  validateIntentRowWithZod,
  SearchIntentSchema,
  IntentJsonlLineSchema,
} from '../../common/src/schemas/intent.ts';
import {
  cellKey,
  allCellKeys,
  getMatrixCell,
  formatIntentMatrixForPrompt,
  formatCellGuidance,
  IntentMatrixFileSchema,
} from '../../common/src/schemas/intentMatrix.ts';
import { migrateGoldenCaseWith, normalizeSkillBand } from '../../common/src/schemas/golden.ts';
import {
  CommandRecipeSchema,
  CommandRowSchema,
  EvalBankQuerySchema,
  GenerationLlmResponseSchema,
  IntentExpandBatchLlmResponseSchema,
  IntentExpandSkipSchema,
  IntentExpansionArraySchema,
  IntentExpansionLlmResponseSchema,
  IntentRewriteLlmResponseSchema,
  RecipeBodyLlmResponseSchema,
  StrictJudgeSchema,
} from '../../common/src/schemas/command.ts';

const tmp = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.tmp-schema-io');
const Num = z.object({ n: z.number() });

describe('schemas/io', () => {
  it('parses JSON and files', () => {
    expect(parseJson('{"n":1}', Num)).toEqual({ n: 1 });
    expect(() => parseJson('{', Num)).toThrow(SchemaParseError);
    expect(() => parseJson('{"n":"x"}', Num)).toThrow(/Schema validation failed/);
    mkdirSync(tmp, { recursive: true });
    const f = path.join(tmp, 'a.json');
    writeFileSync(f, '{"n":2}\n');
    expect(readJsonFile(f, Num)).toEqual({ n: 2 });
    expect(readJsonFile(path.join(tmp, 'missing.json'), Num, { optional: true, fallback: { n: 0 } })).toEqual({
      n: 0,
    });
    expect(() => readJsonFile(path.join(tmp, 'missing.json'), Num)).toThrow(/Missing file/);
    const jsonl = path.join(tmp, 'a.jsonl');
    writeFileSync(jsonl, '{"n":1}\n{"n":2}\n');
    expect(readJsonl(jsonl, Num)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(readJsonl(path.join(tmp, 'none.jsonl'), Num)).toEqual([]);
    writeFileSync(jsonl, 'not-json\n');
    expect(() => readJsonl(jsonl, Num)).toThrow(/JSONL line 1/);
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe('gitCommand schemas', () => {
  it('covers check helpers and zod wrappers', () => {
    expect(checkCommand('').ok).toBe(false);
    expect(checkCommand(`git status ${'x'.repeat(600)}`).reason).toBe('length');
    expect(checkCommand('git -C . status').ok).toBe(true);
    expect(checkCommand('git nope', { extraAllowlist: ['nope'] }).ok).toBe(true);
    expect(checkExample('git status && echo').reason).toBe('shell_meta');
    expect(checkExample('git status # note').reason).toBe('inline_comment');
    expect(checkExample('git status will NOT fetch').reason).toBe('prose');
    expect(gitCommandSchema().safeParse('git status').success).toBe(true);
    expect(gitCommandSchema().safeParse('rm -rf').success).toBe(false);
    expect(gitExampleSchema().safeParse('git add app.js').success).toBe(true);
    expect(gitExampleSchema().safeParse('git add <file>').success).toBe(false);
  });
});

describe('recipe + intent schemas', () => {
  const okRecipe = {
    id: 'r1',
    title: 'Status',
    commands: [{ command: 'git status' }],
  };

  it('validates recipes including flags and json commands', () => {
    expect(validateRecipeWithZod(okRecipe).ok).toBe(true);
    expect(validateRecipeWithZod({}).ok).toBe(false);
    const jsonFail = validateRecipeWithZod({ ...okRecipe, commands: '{bad' });
    expect(jsonFail.ok).toBe(false);
    expect(
      validateRecipeWithZod({
        ...okRecipe,
        commands: JSON.stringify([{ command: 'git status' }]),
      }).ok,
    ).toBe(true);
    expect(
      validateRecipeWithZod(okRecipe, { validateFlags: () => ({ ok: false }) }).reason,
    ).toBe('flags');
    expect(
      validateRecipeWithZod({
        ...okRecipe,
        primary_example: 'git add <file>',
      }).reason,
    ).toBe('placeholder');
    expect(
      validateRecipeWithZod({
        ...okRecipe,
        command: 'git status && x',
      }).reason,
    ).toBe('shell_meta');
    expect(
      validateRecipeWithZod({
        ...okRecipe,
        command: 'git notaverb',
      }).ok,
    ).toBe(true);
    expect(
      ProductRecipeSchema.parse({
        id: 'p1',
        commands: [{ command: 'git status' }],
        title: 'Show status now',
        description: 'See the working tree status for this repo.',
        taxonomy_leaf: 'inspect/status',
        risk: '0.2',
      }).risk,
    ).toBe(0.2);
    expect(MeaningfulnessJudgeLlmSchema.parse({ score: '0.9', pass: true }).score).toBe(0.9);
  });

  it('validates search intents', () => {
    expect(
      validateSearchIntentWithZod({
        id: 'i1',
        recipe_id: 'r1',
        intent_text: 'show status',
        skill_level: 2,
      }).ok,
    ).toBe(true);
    expect(validateSearchIntentWithZod({}).ok).toBe(false);
    expect(
      validateSearchIntentWithZod({
        id: 'i1',
        recipe_id: 'r1',
        intent_text: 'x'.repeat(2001),
        skill_level: 2,
      }).reason,
    ).toBe('length');
    expect(
      validateSearchIntentWithZod(
        { id: 'i1', recipe_id: 'missing', intent_text: 'show status', skill_level: 2 },
        { recipeIds: new Set(['r1']) },
      ).reason,
    ).toBe('fk');
    expect(
      SearchIntentSchema.safeParse({
        id: 'i1',
        recipe_id: 'r1',
        skill_level: 2,
      }).success,
    ).toBe(false);
    expect(validateIntentRowWithZod({ command: 'git status' }).reason).toBe('schema');
    expect(
      validateIntentRowWithZod({
        command: 'git status',
        intent_text: 'x'.repeat(2001),
        skill_level: 2,
      }).reason,
    ).toBe('length');
    expect(
      IntentJsonlLineSchema.parse({
        id: 'i',
        recipe_id: 'r',
        skill_level: '5',
      }).skill_level,
    ).toBe(4);
  });
});

describe('intent matrix helpers', () => {
  it('formats cells and keys', () => {
    const cells = allCellKeys().map(({ skill_level, intent_category }) => ({
      skill_level,
      intent_category,
      description: `desc ${skill_level} ${intent_category}`,
      dos: ['do this'],
      donts: ['dont that'],
    }));
    const matrix = IntentMatrixFileSchema.parse({ version: 1, cells });
    expect(cellKey('beginner', 'goal')).toBe('beginner::goal');
    expect(getMatrixCell(matrix, 'beginner', 'goal')?.description).toContain('beginner');
    expect(getMatrixCell(matrix, 'nope', 'goal')).toBeNull();
    expect(formatIntentMatrixForPrompt(matrix)).toContain('Dos:');
    expect(formatCellGuidance(cells[0])).toContain(cells[0].skill_level);
    expect(formatCellGuidance(cells[0], { includeLabels: false })).not.toContain('##');
  });
});

describe('golden + command schemas', () => {
  it('migrates golden cases and skill bands', () => {
    expect(normalizeSkillBand(null)).toEqual([1, 4]);
    expect(normalizeSkillBand(['beginner', 'nope', 5])).toEqual([2, 2, 4]);
    const migrated = migrateGoldenCaseWith(
      {
        id: 'g1',
        query: 'undo',
        expectedCommand: 'git reset <ref>',
        expectedExample: 'git reset HEAD~1',
        acceptableCommands: ['git reset --soft HEAD'],
      },
      (t) => t,
    );
    expect(migrated.expectedCommand).toBe('git reset');
    const long = migrateGoldenCaseWith(
      { id: 'g2', query: 'q', expectedCommand: 'git commit --amend --no-edit' },
      (t) => t,
    );
    expect(long.expectedCommand).toBe('git commit');
  });

  it('parses command recipe preprocess and expand batch', () => {
    expect(CommandRecipeSchema.parse('{"commands":[{"command":"git status"}]}').commands[0].command).toBe(
      'git status',
    );
    expect(CommandRecipeSchema.parse([{ command: 'git status' }]).commands[0].command).toBe('git status');
    expect(CommandRecipeSchema.safeParse('not-json').success).toBe(false);
    expect(
      CommandRowSchema.parse({
        initial_state: 'inited',
        command_recipe: { commands: [{ command: 'git status' }] },
        initial_state_physical_hash: 'a'.repeat(8),
        final_state_physical_hash: 'b'.repeat(8),
        risk: 0,
        title: '   ',
      }).title,
    ).toBeNull();
    expect(IntentExpandSkipSchema.parse({ skill_level: 'beginner', intent_category: 'goal' }).reason).toBe(
      'unspecified',
    );
    expect(() =>
      IntentExpandBatchLlmResponseSchema.parse({ intents: [], skips: [] }),
    ).toThrow();
    expect(
      IntentExpandBatchLlmResponseSchema.parse({
        intents: [{ skill_level: 'beginner', intent_category: 'goal', intent_text: 'show status' }],
        skips: [],
      }).intents,
    ).toHaveLength(1);
    expect(
      CommandRowSchema.parse({
        initial_state: 'inited',
        command_recipe: { commands: [{ command: 'git status' }] },
        initial_state_physical_hash: 'a'.repeat(8),
        final_state_physical_hash: 'b'.repeat(8),
        risk: 0,
        title: null,
      }).title,
    ).toBeNull();
    expect(
      CommandRowSchema.parse({
        initial_state: 'inited',
        command_recipe: { commands: [{ command: 'git status' }] },
        initial_state_physical_hash: 'a'.repeat(8),
        final_state_physical_hash: 'b'.repeat(8),
        risk: 0,
        title: ' Show working tree ',
      }).title,
    ).toBe('Show working tree');
    expect(
      RecipeBodyLlmResponseSchema.parse({
        initial_state: 'inited',
        command_recipe: { commands: [{ command: 'git status' }] },
        risk: '0.25',
      }).risk,
    ).toBe(0.25);
    expect(
      GenerationLlmResponseSchema.parse({
        initial_state: 'inited',
        command_recipe: { commands: [{ command: 'git status' }] },
        risk: 0,
        title: '  Show status now  ',
      }).title,
    ).toBe('Show status now');
    expect(IntentExpandSkipSchema.parse({
      skill_level: 'beginner',
      intent_category: 'goal',
      reason: '  already covered  ',
    }).reason).toBe('already covered');
    expect(
      IntentExpansionLlmResponseSchema.parse({
        intents: [{ skill_level: 'beginner', intent_category: 'goal', intent_text: 'show status' }],
      }).intents,
    ).toHaveLength(1);
    expect(
      IntentExpansionArraySchema.parse([
        { skill_level: 'beginner', intent_category: 'goal', intent_text: 'show status' },
      ]),
    ).toHaveLength(1);
    expect(IntentRewriteLlmResponseSchema.parse({ intent_text: 'undo last commit' }).intent_text).toBe(
      'undo last commit',
    );
    expect(StrictJudgeSchema.parse({ utility: 0.5, reason: 'ok' }).utility).toBe(0.5);
    expect(EvalBankQuerySchema.parse({ query_text: 'status', command_id: 1, kind: 'golden' }).kind).toBe(
      'golden',
    );
  });
});
