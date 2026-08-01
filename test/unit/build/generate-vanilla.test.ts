import { describe, it, expect } from 'vitest';
import {
  semanticBlockToPrompt,
  VANILLA_GENERATION_SYSTEM,
  generateRecipeFromSemanticBlock,
} from '../../../common/src/build/generate.ts';

describe('vanilla generation from semantic_block', () => {
  const block = {
    command: 'git status',
    blocks: [
      {
        metadata_source: 'tldr/status.md',
        content: '[tldr]\nShow working tree status.\n```\ngit status\n```',
      },
    ],
  };

  it('prompt includes command anchor and block sources', () => {
    const p = semanticBlockToPrompt(block);
    expect(p).toContain('Command anchor: git status');
    expect(p).toContain('tldr/status.md');
    expect(p).toContain('Show working tree status');
  });

  it('system prompt encodes vanilla / minimal-flag rules', () => {
    expect(VANILLA_GENERATION_SYSTEM).toMatch(/MINIMUM args\/flags/i);
    expect(VANILLA_GENERATION_SYSTEM).toMatch(/SINGLE command_recipe step/i);
    expect(VANILLA_GENERATION_SYSTEM).toMatch(/Command anchor/i);
  });

  it('generateRecipeFromSemanticBlock passes prompt to llm', async () => {
    let seen;
    const out = await generateRecipeFromSemanticBlock(block, {
      llmJsonObject: async (args) => {
        seen = args;
        return {
          initial_state: 'git commit --allow-empty -m init\n',
          command_recipe: { commands: [{ command: 'git status', comment: 'check' }] },
          risk: 0.05,
        };
      },
    });
    expect(out.command_recipe.commands[0].command).toBe('git status');
    expect(seen.messages[0].content).toBe(VANILLA_GENERATION_SYSTEM);
    expect(seen.messages[1].content).toContain('Command anchor: git status');
  });
});
