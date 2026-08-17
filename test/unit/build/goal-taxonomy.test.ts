// @ts-nocheck
import { describe, expect, it } from 'bun:test';
import {
  capFanout,
  computeTaxonomyCoverage,
  collectLeaves,
  applyReflectionPatches,
  buildGoalTaxonomy,
} from '../../../common/src/build/goalTaxonomy.ts';

describe('goal taxonomy helpers', () => {
  it('caps fanout', () => {
    const kids = Array.from({ length: 20 }, (_, i) => ({ name: `n${i}` }));
    expect(capFanout(kids, 8)).toHaveLength(8);
    expect(capFanout(null, 8)).toEqual([]);
  });

  it('computes coverage set-arithmetic', () => {
    const scraped = ['git status', 'git commit', 'git push'];
    const leaves = [
      { id: 'a', mapped_commands: ['git status', 'git commit'] },
      { id: 'b', mapped_commands: ['git status'] },
      { id: 'c', mapped_commands: [] },
      { id: 'a', mapped_commands: ['git commit'] },
    ];
    const cov = computeTaxonomyCoverage(leaves, scraped);
    expect(cov.commands_total).toBe(3);
    expect(cov.commands_mapped).toBe(2);
    expect(cov.commands_unmapped).toEqual(['git push']);
    expect(cov.empty_leaves).toEqual(['c']);
    expect(cov.duplicate_leaf_ids).toEqual(['a']);
  });

  it('collects leaves from tree', () => {
    const roots = [
      {
        id: 'root',
        name: 'Root',
        description: 'd',
        depth: 0,
        children: [
          {
            id: 'leaf1',
            name: 'Leaf',
            description: 'l',
            depth: 1,
            mapped_commands: ['git status'],
            children: [],
            is_leaf: true,
          },
        ],
      },
    ];
    const leaves = collectLeaves(roots);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].id).toBe('leaf1');
    expect(leaves[0].path).toEqual(['Root', 'Leaf']);
  });

  it('applies reflection merge/rename and transfers mapped_commands', () => {
    const roots = [
      {
        id: 'keep',
        name: 'Keep',
        description: 'a',
        mapped_commands: ['git status'],
        depth: 0,
        children: [
          {
            id: 'drop',
            name: 'Drop',
            description: 'b',
            mapped_commands: ['git commit'],
            depth: 1,
            children: [],
          },
        ],
      },
    ];
    const next = applyReflectionPatches(roots, {
      rename: [{ id: 'keep', name: 'Kept', description: 'aa' }],
      merge: [{ keep_id: 'keep', drop_ids: ['drop'] }],
    });
    expect(next[0].name).toBe('Kept');
    expect(next[0].description).toBe('aa');
    expect(next[0].children).toEqual([]);
    expect(next[0].mapped_commands).toEqual(['git status', 'git commit']);
  });

  it('flags overmapped leaves in coverage hygiene', () => {
    const scraped = ['git a', 'git b', 'git c', 'git d', 'git e', 'git f', 'git g'];
    const leaves = [{ id: 'fat', mapped_commands: scraped }];
    const cov = computeTaxonomyCoverage(leaves, scraped);
    expect(cov.overmapped_leaves).toEqual(['fat']);
  });
});

describe('buildGoalTaxonomy (mocked LLM)', () => {
  it('builds a mapped taxonomy document', async () => {
    const scraped = ['git status', 'git commit', 'git branch'];
    const smart = async ({ schema }) => {
      const shape = schema?.shape || {};
      if (shape.categories) {
        return {
          categories: [
            { name: 'Inspection', description: 'Look at repo state' },
            { name: 'Branching', description: 'Create and switch branches' },
          ],
        };
      }
      if (shape.children && 'stop' in shape) {
        return { children: [], stop: true };
      }
      if (shape.commands && 'discard' in shape) {
        return { commands: ['git status'], discard: false };
      }
      if (shape.rename) {
        return { rename: [], merge: [], notes: [] };
      }
      if (shape.assign) {
        return {
          assign: [
            { command: 'git commit', leaf_id: 'inspection' },
            { command: 'git branch', leaf_id: 'branching' },
          ],
          new_leaves: [],
        };
      }
      return {};
    };

    const outPath = `${process.env.TMP || process.env.TEMP || '/tmp'}/goal-tax-test.json`;
    const result = await buildGoalTaxonomy({
      scrapedCommands: scraped,
      llmJsonObject: smart,
      maxDepth: 2,
      maxFanout: 4,
      reflectionRounds: 1,
      outPath,
      concurrency: 4,
    });

    expect(result.coverage.commands_unmapped).toEqual([]);
    expect(result.coverage.commands_mapped).toBe(3);
    expect(result.ok).toBe(true);
  });
});
