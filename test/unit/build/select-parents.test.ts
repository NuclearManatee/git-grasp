import { describe, it, expect } from 'vitest';
import { selectEvolutionParentsFromRows } from '../../../common/src/build/loopSelect.ts';

describe('selectEvolutionParents multi-axis', () => {
  it('returns only leaves with mutation_kind assigned', () => {
    const rows = [
      {
        row_id: 1,
        parent_row_id: null,
        initial_state: 'git commit --allow-empty -m init\n',
        command_recipe: { commands: [{ command: 'git status' }] },
        risk: 0.1,
      },
      {
        row_id: 2,
        parent_row_id: null,
        initial_state: 'git commit --allow-empty -m init\n',
        command_recipe: { commands: [{ command: 'git log' }] },
        risk: 0.9,
      },
    ];
    const parents = selectEvolutionParentsFromRows(rows, 10);
    expect(parents).toHaveLength(2);
    expect(parents.every((p) => ['state', 'flag', 'composition'].includes(p.mutation_kind))).toBe(
      true,
    );
  });

  it('prefers undersampled verbs and respects batch cap', () => {
    const rows = [];
    for (let i = 0; i < 5; i += 1) {
      rows.push({
        row_id: i + 1,
        parent_row_id: null,
        initial_state: 'init\n',
        command_recipe: { commands: [{ command: 'git status' }] },
        risk: 0.2,
      });
    }
    rows.push({
      row_id: 99,
      parent_row_id: null,
      initial_state: 'init\n',
      command_recipe: { commands: [{ command: 'git log' }] },
      risk: 0.2,
    });
    const parents = selectEvolutionParentsFromRows(rows, 2);
    expect(parents).toHaveLength(2);
    expect(parents.some((p) => JSON.stringify(p.command_recipe).includes('git log'))).toBe(true);
  });

  it('skips non-leaves', () => {
    const rows = [
      {
        row_id: 1,
        parent_row_id: null,
        initial_state: 'init\n',
        command_recipe: { commands: [{ command: 'git status' }] },
        risk: 0.1,
      },
      {
        row_id: 2,
        parent_row_id: 1,
        initial_state: 'init\n',
        command_recipe: { commands: [{ command: 'git status -s' }] },
        risk: 0.2,
        mutation_kind: 'flag',
      },
    ];
    const parents = selectEvolutionParentsFromRows(rows, 10);
    expect(parents.every((p) => p.row_id !== 1)).toBe(true);
    expect(parents.some((p) => p.row_id === 2)).toBe(true);
  });
});
