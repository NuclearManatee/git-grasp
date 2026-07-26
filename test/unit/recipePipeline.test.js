import { describe, it, expect } from 'vitest';
import {
  parseFlagsFromManText,
  extractFlagsFromRun,
  makeFlagValidator,
} from '../../packages/core/src/catalog/sources/manOracle.js';
import { parseEverydayExamples } from '../../packages/core/src/catalog/sources/cheatSheet.js';
import { parseTldrPage, mergeCommandUniverse } from '../../packages/core/src/catalog/sources/tldr.js';
import { parseProgitChapter } from '../../packages/core/src/catalog/sources/progit.js';
import { filterNearDuplicateIntents } from '../../packages/core/src/catalog/nearDup.js';
import { mockEmbed } from '../../packages/core/src/search/embed.js';
import {
  recipesFromUniverse,
  fixtureRecipes,
} from '../../packages/core/src/catalog/stepRecipes.js';
import { normalizeRecipes, normalizeIntents } from '../../packages/core/src/catalog/stepRecipeNormalize.js';
import { heuristicIntentsForRecipe } from '../../packages/core/src/catalog/stepRecipeIntents.js';
import { renderSnippet } from '../../packages/core/src/db/recipeFormat.js';
import { formatSnippetBlock } from '../../packages/core/src/ux/format.js';

describe('man oracle', () => {
  it('parses flags from man text', () => {
    const flags = parseFlagsFromManText('git-reset --soft --hard -q --quiet');
    expect(flags.has('--soft')).toBe(true);
    expect(flags.has('--hard')).toBe(true);
  });

  it('extracts flags from a run line', () => {
    const { subcommand, flags } = extractFlagsFromRun('git reset --soft HEAD~1');
    expect(subcommand).toBe('reset');
    expect(flags).toContain('--soft');
  });

  it('validates unknown flags', () => {
    const validate = makeFlagValidator({
      subcommands: { reset: ['--soft', '--hard', '-q'] },
    });
    expect(validate('git reset --soft HEAD~1').ok).toBe(true);
    expect(validate('git reset --not-a-real-flag').ok).toBe(false);
  });
});

describe('source parsers', () => {
  it('parses giteveryday-style lines', () => {
    const examples = parseEverydayExamples('$ git init\n$ git add .\n$ git commit -m "import"');
    expect(examples.some((e) => e.run === 'git init')).toBe(true);
    expect(examples.some((e) => e.run.startsWith('git add'))).toBe(true);
  });

  it('parses git lines from HTML pre blocks', async () => {
    const { parseEverydayFromHtml } = await import('../../packages/core/src/catalog/sources/cheatSheet.js');
    const examples = parseEverydayFromHtml('<pre>$ git status\n$ git add .\n</pre>');
    expect(examples.some((e) => e.run === 'git status')).toBe(true);
  });

  it('parses tldr pages', () => {
    const md = `# git status\n\n- Show status:\n\n\`git status\`\n`;
    const examples = parseTldrPage(md, 'git-status');
    expect(examples[0].run).toBe('git status');
  });

  it('cheat sheet wins over tldr on merge', () => {
    const merged = mergeCommandUniverse(
      [{ run: 'git status', comment: 'from cs', source: 'cheat-sheet' }],
      [{ run: 'git status', comment: 'from tldr', source: 'tldr' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('cheat-sheet');
    expect(merged[0].comment).toBe('from cs');
  });

  it('parses progit code blocks', () => {
    const blocks = parseProgitChapter('----\n$ git status\n$ git add .\n----', 'ch2');
    expect(blocks.some((b) => b.runs.includes('git status'))).toBe(true);
  });
});

describe('near-dup filter', () => {
  it('drops near-identical intents', async () => {
    const kept = await filterNearDuplicateIntents(
      ['undo last commit', 'UNDO LAST COMMIT', 'show status'],
      { embedFn: mockEmbed, maxCosine: 0.99 },
    );
    expect(kept.map((s) => s.toLowerCase())).toContain('undo last commit');
    expect(kept.map((s) => s.toLowerCase())).toContain('show status');
    expect(kept.length).toBe(2);
  });
});

describe('recipe synthesize + normalize', () => {
  it('builds recipes from universe and normalizes', () => {
    const raw = recipesFromUniverse([
      { run: 'git status', comment: 'show status', source: 'cheat-sheet' },
    ]);
    expect(raw[0].primary_example).toBe('git status');
    const { recipes } = normalizeRecipes(raw);
    expect(recipes).toHaveLength(1);
    const intents = heuristicIntentsForRecipe(recipes[0]);
    const { intents: normI } = normalizeIntents(intents, recipes);
    expect(normI.length).toBeGreaterThan(0);
  });

  it('fixture recipes include multi-step', () => {
    const fixtures = fixtureRecipes();
    const multi = fixtures.find((r) => r.commands.length > 1);
    expect(multi).toBeTruthy();
    expect(renderSnippet(multi.commands)).toContain('#');
    const lines = formatSnippetBlock(multi);
    expect(lines.some((l) => l.includes('git switch'))).toBe(true);
  });
});

describe('recipe + intent Are-you-sure expansion', () => {
  it('materializes and merges AYS recipes', async () => {
    const {
      materializeAysRecipe,
      mergeRecipes,
      expandRecipesWithAreYouSure,
    } = await import('../../packages/core/src/catalog/stepRecipeAys.js');

    const draft = materializeAysRecipe({
      title: 'Soft undo last commit',
      topic: 'undo',
      command: 'git reset',
      explanation: 'Keep staged changes',
      commands: [{ run: 'git reset --soft HEAD~1', comment: 'keep staged' }],
    });
    expect(draft.primary_example).toContain('reset --soft');

    const base = recipesFromUniverse([
      { run: 'git status', comment: 'status', source: 'cheat-sheet' },
    ]);
    const merged = mergeRecipes(base, [draft]);
    expect(merged.length).toBe(2);

    let calls = 0;
    const llmJson = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          sure: false,
          additional_recipes: [{
            title: 'Abort a merge',
            topic: 'merge',
            command: 'git merge',
            explanation: 'Cancel an in-progress merge',
            commands: [{ run: 'git merge --abort', comment: 'abort merge' }],
          }],
          rationale: 'missing abort',
        };
      }
      return { sure: true, additional_recipes: [], rationale: 'ok' };
    };
    const out = await expandRecipesWithAreYouSure(base, {
      llmJson,
      maxRounds: 3,
      minRecipes: 1,
    });
    expect(out.recipes.some((r) => r.primary_example.includes('merge --abort'))).toBe(true);
    expect(out.rounds.length).toBeGreaterThan(0);
  });

  it('expands intents with AYS after base LLM band', async () => {
    const {
      generateIntentsForRecipeWithAreYouSure,
      intentCountForRecipe,
    } = await import('../../packages/core/src/catalog/stepRecipeIntents.js');
    const recipe = fixtureRecipes()[0];
    expect(intentCountForRecipe(recipe)).toBeGreaterThanOrEqual(4);

    let phase = 0;
    const llmJson = async ({ messages }) => {
      const sys = messages[0].content;
      if (sys.includes('INTENT WRITER')) {
        phase += 1;
        return {
          intents: [
            { skill_level: 'beginner', intent_descriptions: ['undo last commit keep changes', 'soft reset last commit'] },
            { skill_level: 'non-technical', intent_descriptions: ['undo my last save but keep files'] },
            { skill_level: 'intermediate', intent_descriptions: ['git reset soft HEAD~1'] },
            { skill_level: 'expert', intent_descriptions: ['soft reset HEAD~1'] },
          ],
        };
      }
      // AYS
      return {
        sure: true,
        additional_intents: [
          { skill_level: 'non-technical', intent_descriptions: ['I messed up please keep my work'] },
        ],
        rationale: 'add panic phrasing',
      };
    };

    const { intents, rounds } = await generateIntentsForRecipeWithAreYouSure(recipe, {
      llmJson,
      embedFn: mockEmbed,
      maxRounds: 2,
      minIntents: 4,
    });
    expect(intents.length).toBeGreaterThanOrEqual(4);
    expect(intents.some((i) => /messed up|keep/i.test(i.intent_text))).toBe(true);
    expect(phase).toBeGreaterThanOrEqual(1);
    expect(rounds.length).toBeGreaterThanOrEqual(0);
  });
});
