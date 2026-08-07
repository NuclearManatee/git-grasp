import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIM } from '../../../common/src/db/constants.ts';
import { expandIntentsForRecipe, shouldPersistIntent } from '../../../common/src/build/intentExpand.ts';
import { SKILL_LEVELS, INTENT_CATEGORIES } from '../../../common/src/lib/skills.ts';
import { renderPrompt } from '../../../common/src/lib/prompts.ts';

const RECIPE = {
  initial_state: 'git init\n',
  command_recipe: { commands: [{ command: 'git status', comment: 'show status' }] },
};

function unitVec(seed: number) {
  const out = new Float32Array(EMBEDDING_DIM);
  out[seed % EMBEDDING_DIM] = 1;
  return out;
}

function minimalMatrix() {
  const cells = [];
  for (const skill_level of SKILL_LEVELS) {
    for (const intent_category of INTENT_CATEGORIES) {
      cells.push({
        skill_level,
        intent_category,
        description: `${skill_level} ${intent_category}`,
        dos: ['do'],
        donts: ['dont'],
      });
    }
  }
  return { version: 1, generated_at: '2026-01-01T00:00:00.000Z', cells };
}

function allCells() {
  const out = [];
  for (const skill_level of SKILL_LEVELS) {
    for (const intent_category of INTENT_CATEGORIES) {
      out.push({ skill_level, intent_category });
    }
  }
  return out;
}

describe('expand-intents / rewrite prompts', () => {
  it('expand-intents includes empty cells and batch size', () => {
    const { messages } = renderPrompt('build/expand-intents', {
      matrix: '# matrix',
      empty_cells: '- beginner × goal',
      batch_size: '8',
      primary: 'git status',
      listing: '- git status',
      initial_state: 'git init',
      composition_guidance:
        'Soft delta (optional): when the recipe listing shows extra steps, about 1–2 intents may lightly mention that cue.',
    });
    expect(messages[0].content).toContain('EMPTY CELLS');
    expect(messages[0].content).toContain('Soft delta');
    expect(messages[1].content).toContain('beginner × goal');
    expect(messages[0].content).toContain('8');
  });

  it('rewrite-intent-contrast renders neighbor text', () => {
    const { messages } = renderPrompt('build/rewrite-intent-contrast', {
      skill_level: 'beginner',
      intent_category: 'goal',
      primary: 'git status',
      listing: '- git status',
      initial_state: 'git init',
      intent_text: 'show status',
      neighbor_text: 'conflicting query',
    });
    expect(messages[1].content).toContain('conflicting query');
    expect(messages[1].content).toContain('show status');
  });
});

describe('expandIntentsForRecipe iterative loop', () => {
  it('exits when LLM skips all empty cells', async () => {
    let calls = 0;
    const intents = await expandIntentsForRecipe(RECIPE, {
      matrix: minimalMatrix(),
      embedder: { embed: async (t) => unitVec(String(t).length) },
      llmJsonObject: async () => {
        calls += 1;
        return {
          intents: [],
          skips: allCells().map((c) => ({
            ...c,
            reason: 'not applicable',
          })),
        };
      },
    });
    expect(intents).toHaveLength(0);
    expect(calls).toBe(1);
  });

  it('fills across rounds then stops when all decided', async () => {
    const cells = allCells();
    let calls = 0;
    const intents = await expandIntentsForRecipe(RECIPE, {
      matrix: minimalMatrix(),
      batchSize: 8,
      embedder: {
        embed: async (t) => {
          const m = String(t).match(/seed-(\d+)/);
          return unitVec(m ? Number(m[1]) : 0);
        },
      },
      llmJsonObject: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            intents: cells.slice(0, 8).map((c, i) => ({
              ...c,
              intent_text: `status query seed-${i} please`,
            })),
            skips: [],
          };
        }
        return {
          intents: cells.slice(8).map((c, i) => ({
            ...c,
            intent_text: `status query seed-${i + 8} please`,
          })),
          skips: [],
        };
      },
    });
    expect(intents).toHaveLength(16);
    expect(calls).toBe(2);
  });

  it('stops at per-recipe cap', async () => {
    let calls = 0;
    const intents = await expandIntentsForRecipe(RECIPE, {
      matrix: minimalMatrix(),
      cap: 4,
      batchSize: 8,
      zeroStreakMax: 10,
      embedder: {
        embed: async (t) => {
          const m = String(t).match(/seed-(\d+)/);
          return unitVec(m ? Number(m[1]) : 99);
        },
      },
      llmJsonObject: async () => {
        calls += 1;
        return {
          intents: allCells().slice(0, 8).map((c, i) => ({
            ...c,
            intent_text: `cap seed-${i} status check`,
          })),
          skips: [],
        };
      },
    });
    expect(intents).toHaveLength(4);
    // One batch fills to cap; loop must not keep calling the LLM.
    expect(calls).toBe(1);
  });

  it('zero-growth streak exits with empty cells remaining', async () => {
    let calls = 0;
    const intents = await expandIntentsForRecipe(RECIPE, {
      matrix: minimalMatrix(),
      zeroStreakMax: 3,
      batchSize: 4,
      embedder: { embed: async () => unitVec(0) },
      llmJsonObject: async () => {
        calls += 1;
        // Always return the same near-dup text → within-dup → +0 keepers
        return {
          intents: [
            {
              skill_level: 'beginner',
              intent_category: 'goal',
              intent_text: 'identical status wording always',
            },
          ],
          skips: [],
        };
      },
    });
    // First round may keep one; subsequent rounds are near-dups → streak
    expect(intents.length).toBeLessThanOrEqual(1);
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(calls).toBeLessThanOrEqual(5);
  });

  it('foreign collision triggers one rewrite then keeps', async () => {
    let expandCalls = 0;
    let rewriteCalls = 0;
    const intents = await expandIntentsForRecipe(RECIPE, {
      matrix: minimalMatrix(),
      selfCommandId: 1,
      embedder: {
        embed: async (t) => {
          if (String(t).includes('rewritten')) return unitVec(7);
          return unitVec(1);
        },
      },
      knnForeign: async (emb) => {
        // unitVec(1) collides; unitVec(7) does not
        const sim = emb[1] === 1 ? 0.95 : 0.1;
        return [{ command_id: 99, intent_text: 'foreign status', similarity: sim }];
      },
      llmJsonObject: async (args) => {
        const sys = String(args?.messages?.[0]?.content || '');
        if (sys.includes('rewrite') || sys.includes('Conflicting') || args?.schema?.shape?.intent_text) {
          rewriteCalls += 1;
          return { intent_text: 'rewritten distinct status query about working tree' };
        }
        expandCalls += 1;
        if (expandCalls === 1) {
          return {
            intents: [
              {
                skill_level: 'beginner',
                intent_category: 'goal',
                intent_text: 'original colliding status query',
              },
            ],
            skips: allCells()
              .filter((c) => !(c.skill_level === 'beginner' && c.intent_category === 'goal'))
              .map((c) => ({ ...c, reason: 'skip' })),
          };
        }
        return {
          intents: [],
          skips: allCells().map((c) => ({ ...c, reason: 'done' })),
        };
      },
    });
    expect(rewriteCalls).toBe(1);
    expect(intents).toHaveLength(1);
    expect(intents[0].intent_text).toContain('rewritten');
  });

  it('foreign collision drops after failed rewrite budget', async () => {
    const intents = await expandIntentsForRecipe(RECIPE, {
      matrix: minimalMatrix(),
      rewriteMax: 1,
      embedder: { embed: async () => unitVec(2) },
      knnForeign: async () => [
        { command_id: 42, intent_text: 'other', similarity: 0.99 },
      ],
      llmJsonObject: async (args) => {
        if (args?.schema?.shape?.intent_text) {
          return { intent_text: 'still colliding after rewrite status' };
        }
        return {
          intents: [
            {
              skill_level: 'beginner',
              intent_category: 'goal',
              intent_text: 'will collide status',
            },
          ],
          skips: allCells()
            .filter((c) => !(c.skill_level === 'beginner' && c.intent_category === 'goal'))
            .map((c) => ({ ...c, reason: 'skip' })),
        };
      },
    });
    expect(intents).toHaveLength(0);
  });

  it('keeps intents colliding with excluded parent command_id', async () => {
    const intents = await expandIntentsForRecipe(RECIPE, {
      matrix: minimalMatrix(),
      selfCommandId: 89,
      excludeCommandIds: new Set([16]),
      rewriteMax: 0,
      embedder: { embed: async () => unitVec(2) },
      knnForeign: async () => [
        { command_id: 16, intent_text: 'parent intent', similarity: 0.99 },
      ],
      llmJsonObject: async () => ({
        intents: [
          {
            skill_level: 'beginner',
            intent_category: 'goal',
            intent_text: 'check the working tree status now',
          },
        ],
        skips: allCells()
          .filter((c) => !(c.skill_level === 'beginner' && c.intent_category === 'goal'))
          .map((c) => ({ ...c, reason: 'skip' })),
      }),
    });
    expect(intents).toHaveLength(1);
  });

  it('works without knnForeign (within-only)', async () => {
    const intents = await expandIntentsForRecipe(RECIPE, {
      matrix: minimalMatrix(),
      knnForeign: null,
      embedder: {
        embed: async (t) => unitVec(String(t).includes('two') ? 2 : 1),
      },
      llmJsonObject: async () => ({
        intents: [
          {
            skill_level: 'beginner',
            intent_category: 'goal',
            intent_text: 'one status query',
          },
          {
            skill_level: 'beginner',
            intent_category: 'symptom',
            intent_text: 'two status query',
          },
        ],
        skips: allCells()
          .filter(
            (c) =>
              !(
                (c.skill_level === 'beginner' && c.intent_category === 'goal') ||
                (c.skill_level === 'beginner' && c.intent_category === 'symptom')
              ),
          )
          .map((c) => ({ ...c, reason: 'skip' })),
      }),
    });
    expect(intents).toHaveLength(2);
  });
});

describe('shouldPersistIntent', () => {
  it('drops within near-dup and foreign collision', async () => {
    const emb = unitVec(0);
    const within = await shouldPersistIntent({
      intent_text: 'a',
      embedding: emb,
      existingEmbeddings: [unitVec(0)],
    });
    expect(within.ok).toBe(false);
    expect(within.reason).toBe('within_near_dup');

    const foreign = await shouldPersistIntent({
      intent_text: 'b',
      embedding: unitVec(3),
      existingEmbeddings: [],
      selfCommandId: 1,
      knnForeign: async () => [
        { command_id: 9, intent_text: 'x', similarity: 0.95 },
      ],
    });
    expect(foreign.ok).toBe(false);
    expect(foreign.reason).toBe('foreign_collision');

    const ok = await shouldPersistIntent({
      intent_text: 'c',
      embedding: unitVec(4),
      existingEmbeddings: [unitVec(0)],
      selfCommandId: 1,
      knnForeign: async () => [
        { command_id: 1, intent_text: 'self', similarity: 0.99 },
        { command_id: 2, intent_text: 'other', similarity: 0.5 },
      ],
    });
    expect(ok.ok).toBe(true);
  });

  it('honors excludeCommandIds for parent lineage', async () => {
    const dropped = await shouldPersistIntent({
      intent_text: 'child',
      embedding: unitVec(5),
      existingEmbeddings: [],
      selfCommandId: 89,
      knnForeign: async () => [
        { command_id: 16, intent_text: 'parent', similarity: 0.99 },
      ],
    });
    expect(dropped.ok).toBe(false);

    const kept = await shouldPersistIntent({
      intent_text: 'child',
      embedding: unitVec(5),
      existingEmbeddings: [],
      selfCommandId: 89,
      excludeCommandIds: new Set([16]),
      knnForeign: async () => [
        { command_id: 16, intent_text: 'parent', similarity: 0.99 },
      ],
    });
    expect(kept.ok).toBe(true);
  });
});
