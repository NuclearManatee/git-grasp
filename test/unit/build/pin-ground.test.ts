import { describe, it, expect } from 'vitest';
import {
  initialStateForPin,
  seedIntentsToRows,
  pinToCandidate,
  validatePinForGround,
} from '../../../common/src/build/pinGround.ts';

const taxonomyVerbs = new Set(['git config', 'git blame', 'git bisect']);

describe('pinGround', () => {
  it('maps seed intents to goal rows', () => {
    const rows = seedIntentsToRows(['change my username', 'set git user.name', 'who am i in git']);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.intent_category).toBe('goal');
    expect(rows[0]!.intent_text).toContain('username');
  });

  it('builds config candidate with init state', () => {
    const pin = {
      goal_id: 'config-user-name',
      verb: 'git config',
      goal_roles: ['identity'] as const,
      recipe_sketch: {
        commands: [{ command: 'git config --global user.name', comment: '' }],
      },
      seed_intents: ['a', 'b', 'c'],
    };
    const c = pinToCandidate(pin as any);
    expect(c.command_recipe.commands[0]!.command).toContain('git config');
    expect(initialStateForPin(pin as any)).toContain('git commit --allow-empty');
  });

  it('validatePinForGround fails closed on unknown verb', () => {
    const r = validatePinForGround(
      {
        goal_id: 'x',
        verb: 'git svn',
        goal_roles: ['niche'],
        recipe_sketch: { commands: [{ command: 'git svn' }] },
        seed_intents: ['a', 'b', 'c'],
      } as any,
      { taxonomyVerbs },
    );
    expect(r.ok).toBe(false);
  });

  it('validatePinForGround accepts sandbox-ok pin via mock validate', () => {
    const pin = {
      goal_id: 'config-user-name',
      verb: 'git config',
      goal_roles: ['identity'],
      recipe_sketch: {
        commands: [{ command: 'git config user.name Ada', comment: '' }],
      },
      seed_intents: ['set name', 'change username', 'git author name'],
    };
    const r = validatePinForGround(pin as any, {
      taxonomyVerbs,
      validate: () => ({
        ok: true,
        initial_state_physical_hash: 'a',
        final_state_physical_hash: 'b',
      }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.intents.length).toBe(3);
  });

  it('normalizes placeholders in sketches', async () => {
    const { normalizePinRecipeSketch } = await import(
      '../../../common/src/build/pinGround.ts'
    );
    const p = normalizePinRecipeSketch({
      goal_id: 'blame-file-lines',
      verb: 'git blame',
      goal_roles: ['authorship'],
      recipe_sketch: { commands: [{ command: 'git blame <file>', comment: '' }] },
      seed_intents: ['a', 'b', 'c'],
    } as any);
    expect(p.recipe_sketch.commands[0]!.command).toBe('git blame f.txt');
  });
});
