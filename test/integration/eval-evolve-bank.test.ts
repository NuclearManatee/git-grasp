import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, insertCommand } from '../../common/src/db/schema.js';
import {
  appendEvolveGolden,
  loadBank,
  tagGolden,
} from '../../common/src/build/evalGate.js';

describe('eval evolve bank growth', () => {
  let evalDir;
  let prevEvalDir;

  beforeEach(() => {
    evalDir = mkdtempSync(path.join(tmpdir(), 'gh-eval-bank-'));
    prevEvalDir = process.env.GIT_GRASP_EVAL_DIR;
    process.env.GIT_GRASP_EVAL_DIR = evalDir;
  });

  afterEach(() => {
    if (prevEvalDir === undefined) delete process.env.GIT_GRASP_EVAL_DIR;
    else process.env.GIT_GRASP_EVAL_DIR = prevEvalDir;
    try {
      rmSync(evalDir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('appendEvolveGolden grows golden.jsonl with mutation_kind tags', () => {
    const db = openDb(':memory:');
    const row_id = insertCommand(db, {
      initial_state: 'git commit --allow-empty -m init\n',
      command_recipe: { commands: [{ command: 'git status --short' }] },
      initial_state_physical_hash: 'i-ev',
      final_state_physical_hash: 'f-ev',
      risk: 0.1,
      mutation_kind: 'flag',
    });
    const row = db.prepare('SELECT * FROM commands WHERE row_id = ?').get(row_id);
    db.close();

    const tagged = appendEvolveGolden(row, {
      query_text: 'short status listing',
      command_id: row_id,
      kind: 'golden',
    });
    expect(tagged.mutation_kind).toBe('flag');
    expect(tagged.primary_verb).toBe('git status');

    appendEvolveGolden(
      { ...row, mutation_kind: 'state', row_id: row_id + 1 },
      { query_text: 'status when dirty', command_id: row_id + 1, kind: 'golden' },
    );

    const bank = loadBank('golden.jsonl');
    expect(bank).toHaveLength(2);
    expect(bank[0].mutation_kind).toBe('flag');
    expect(bank[1].mutation_kind).toBe('state');
    expect(existsSync(path.join(evalDir, 'golden.jsonl'))).toBe(true);
    const raw = readFileSync(path.join(evalDir, 'golden.jsonl'), 'utf8');
    expect(raw).toContain('"mutation_kind":"flag"');
  });

  it('tagGolden preserves ground vs evolve distinction', () => {
    const g = tagGolden(
      { query_text: 'x', command_id: 1, kind: 'golden' },
      { mutation_kind: 'ground', primary_verb: 'git log' },
    );
    expect(g.mutation_kind).toBe('ground');
    const e = tagGolden(
      { query_text: 'y', command_id: 2, kind: 'golden' },
      { mutation_kind: 'composition', primary_verb: 'git rebase' },
    );
    expect(e.mutation_kind).toBe('composition');
  });
});
