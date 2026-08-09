import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  openDb,
  insertRecipe,
  rebuildRecipesFts,
  ftsRecall,
  countRecipesFts,
} from '../../common/src/db/schema.js';

describe('recipes_fts', () => {
  let db;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  afterEach(() => {
    db?.close();
  });

  it('indexes command+comment+description and ranks by BM25', () => {
    insertRecipe(db, {
      id: 'r-soft',
      title: 'Soft reset',
      description: 'undo commit keep staged files',
      tags: ['undo'],
      taxonomy_leaf: 'undo',
      paraphrases: [],
      provenance: 'synthetic',
      validated: true,
      commands: [{ command: 'git reset --soft HEAD~1', comment: 'keep staged' }],
      initial_state: '',
      risk: 0.2,
    });
    insertRecipe(db, {
      id: 'r-status',
      title: 'Status',
      description: 'show working tree',
      tags: ['inspect'],
      taxonomy_leaf: 'inspect',
      paraphrases: [],
      provenance: 'synthetic',
      validated: true,
      commands: [{ command: 'git status', comment: 'show working tree' }],
      initial_state: '',
      risk: 0.1,
    });
    rebuildRecipesFts(db);
    expect(countRecipesFts(db)).toBe(2);

    const soft = ftsRecall(db, 'reset soft keep staged', 10);
    expect(soft.length).toBeGreaterThan(0);
    expect(String(soft[0].recipe_id)).toBe('r-soft');
    expect(typeof soft[0].bm25).toBe('number');

    const status = ftsRecall(db, 'status working', 10);
    expect(String(status[0].recipe_id)).toBe('r-status');
  });

  it('returns empty for empty/special-only query', () => {
    insertRecipe(db, {
      id: 'r-x',
      title: 'Status',
      description: 'status',
      tags: [],
      taxonomy_leaf: 'x',
      paraphrases: [],
      provenance: 'synthetic',
      validated: true,
      commands: [{ command: 'git status' }],
      initial_state: '',
      risk: 0,
    });
    rebuildRecipesFts(db);
    expect(ftsRecall(db, '   ', 10)).toEqual([]);
    expect(ftsRecall(db, '***', 10)).toEqual([]);
  });
});
