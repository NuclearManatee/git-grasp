import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CommandRecipeSchema,
  CommandRowSchema,
  GenerationLlmResponseSchema,
  IntentExpansionLlmResponseSchema,
  IntentRowSchema,
  SemanticBlockSchema,
  StrictJudgeSchema,
  SkillLevelTextSchema,
  IntentCategorySchema,
} from '../../../packages/core/src/schemas/command.ts';
import { PACKAGE_ROOT } from '../../../packages/core/src/lib/paths.ts';
import { INTENT_CATEGORIES, SKILL_LEVELS, normalizeSkillLevelText } from '../../../packages/core/src/lib/skills.ts';

describe('v6 command schemas', () => {
  it('parses command_recipe with command+comment', () => {
    const r = CommandRecipeSchema.parse({
      commands: [{ command: 'git status', comment: 'check' }],
    });
    expect(r.commands[0].command).toBe('git status');
  });

  it('parses generation LLM response with risk', () => {
    const r = GenerationLlmResponseSchema.parse({
      initial_state: 'git init\n',
      command_recipe: { commands: [{ command: 'git status' }] },
      risk: 0.1,
    });
    expect(r.risk).toBe(0.1);
  });

  it('allows 1–16 intent expansion items', () => {
    expect(() =>
      IntentExpansionLlmResponseSchema.parse({ intents: [] }),
    ).toThrow();
    const one = IntentExpansionLlmResponseSchema.parse({
      intents: [
        { skill_level: 'beginner', intent_category: 'goal', intent_text: 'show status' },
      ],
    });
    expect(one.intents).toHaveLength(1);
  });

  it('parses strict judge', () => {
    const j = StrictJudgeSchema.parse({ utility: 0.95, reason: 'aligned' });
    expect(j.utility).toBeGreaterThan(0.9);
  });

  it('parses semantic_block', () => {
    const g = SemanticBlockSchema.parse({
      command: 'git status',
      blocks: [{ metadata_source: 'tldr', content: 'Show the working tree status' }],
    });
    expect(g.blocks).toHaveLength(1);
    expect(g.command).toBe('git status');
  });

  it('parses command and intent rows', () => {
    CommandRowSchema.parse({
      initial_state: 'git init',
      command_recipe: { commands: [{ command: 'git status' }] },
      initial_state_physical_hash: 'a',
      final_state_physical_hash: 'b',
      risk: 0,
      mutation_kind: 'state',
    });
    IntentRowSchema.parse({
      command_id: 1,
      skill_level: 'nontechnical',
      intent_category: 'symptom',
      intent_text: 'where did my changes go',
    });
  });
});

describe('taxonomy + skill enums', () => {
  it('ships skill_level.md, intent_category.md, and git_commands.json', () => {
    const dir = path.join(PACKAGE_ROOT, 'packages', 'core', 'taxonomy');
    expect(existsSync(path.join(dir, 'skill_level.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'intent_category.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'git_commands.json'))).toBe(true);
    expect(readFileSync(path.join(dir, 'skill_level.md'), 'utf8')).toMatch(/nontechnical/);
    expect(readFileSync(path.join(dir, 'intent_category.md'), 'utf8')).toMatch(/error_message/);
  });

  it('exhausts skill and category enums', () => {
    for (const s of SKILL_LEVELS) {
      expect(SkillLevelTextSchema.parse(s)).toBe(s);
    }
    for (const c of INTENT_CATEGORIES) {
      expect(IntentCategorySchema.parse(c)).toBe(c);
    }
    expect(normalizeSkillLevelText('non-technical')).toBe('nontechnical');
  });
});
