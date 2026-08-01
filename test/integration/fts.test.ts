import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  openDb,
  insertCommand,
  rebuildCommandsFts,
  ftsRecall,
  countCommandsFts,
} from '../../packages/core/src/db/schema.js';

describe('commands_fts', () => {
  let db;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  afterEach(() => {
    db?.close();
  });

  it('indexes command+comment and ranks by BM25', () => {
    const a = insertCommand(db, {
      initial_state: 'git init\n',
      command_recipe: {
        commands: [{ command: 'git reset --soft HEAD~1', comment: 'keep staged' }],
      },
      initial_state_physical_hash: 'a1',
      final_state_physical_hash: 'a2',
      risk: 0.2,
    });
    const b = insertCommand(db, {
      initial_state: 'git init\n',
      command_recipe: {
        commands: [{ command: 'git status', comment: 'show working tree' }],
      },
      initial_state_physical_hash: 'b1',
      final_state_physical_hash: 'b2',
      risk: 0.1,
    });
    rebuildCommandsFts(db);
    expect(countCommandsFts(db)).toBe(2);

    const soft = ftsRecall(db, 'reset soft keep staged', 10);
    expect(soft.length).toBeGreaterThan(0);
    expect(Number(soft[0].command_id)).toBe(a);
    expect(typeof soft[0].bm25).toBe('number');

    const status = ftsRecall(db, 'status working', 10);
    expect(Number(status[0].command_id)).toBe(b);
  });

  it('returns empty for empty/special-only query', () => {
    insertCommand(db, {
      initial_state: 'git init\n',
      command_recipe: { commands: [{ command: 'git status' }] },
      initial_state_physical_hash: 'x',
      final_state_physical_hash: 'y',
      risk: 0,
    });
    rebuildCommandsFts(db);
    expect(ftsRecall(db, '   ', 10)).toEqual([]);
    expect(ftsRecall(db, '***', 10)).toEqual([]);
  });
});
