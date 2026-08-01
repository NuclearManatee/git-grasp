import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  openDb,
  insertCommand,
  insertCommandEmbedding,
  insertIntentWithEmbedding,
  finalizeSearchIndex,
  promoteStagingDb,
  countCommandsFts,
  SEARCH_ALGORITHM_VERSION,
  EMBEDDING_DIM,
} from '../../packages/core/src/db/schema.js';

function fakeEmb(seed = 1) {
  const a = new Float32Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) a[i] = ((seed + i) % 7) / 7;
  return a;
}

describe('finalizeSearchIndex + promote', () => {
  let dir;
  let staging;
  let prod;
  /** @type {import('bun:sqlite').Database[]} */
  let openHandles;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gh-search-'));
    staging = path.join(dir, 'staging.db');
    prod = path.join(dir, 'prod.db');
    openHandles = [];
  });

  afterEach(() => {
    for (const h of openHandles) {
      try {
        h.close();
      } catch {
        /* */
      }
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows file lock — ignore */
    }
  });

  it('writes FTS, git_verbs, search_algorithm_version; staging keeps vec_commands', () => {
    const db = openDb(staging);
    openHandles.push(db);
    const id = insertCommand(db, {
      initial_state: 'git init\n',
      command_recipe: {
        commands: [{ command: 'git reset --soft HEAD~1', comment: 'keep' }],
      },
      initial_state_physical_hash: 'i',
      final_state_physical_hash: 'f',
      risk: 0.2,
    });
    insertCommandEmbedding(db, id, fakeEmb(1));
    insertIntentWithEmbedding(db, {
      command_id: id,
      skill_level: 'beginner',
      intent_category: 'goal',
      intent_text: 'undo last commit',
      embedding: fakeEmb(2),
    });
    const meta = finalizeSearchIndex(db);
    expect(countCommandsFts(db)).toBe(1);
    expect(meta.verbs).toContain('reset');
    expect(meta.searchAlgorithmVersion).toBe(SEARCH_ALGORITHM_VERSION);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    expect(tables).toContain('vec_commands');
    db.close();
  });

  it('promote drops vec_commands from shipped DB', () => {
    const db = openDb(staging);
    openHandles.push(db);
    const id = insertCommand(db, {
      initial_state: 'git init\n',
      command_recipe: { commands: [{ command: 'git status' }] },
      initial_state_physical_hash: 'a',
      final_state_physical_hash: 'b',
      risk: 0,
    });
    insertCommandEmbedding(db, id, fakeEmb(3));
    finalizeSearchIndex(db);
    db.close();

    promoteStagingDb(staging, prod);

    const shipped = openDb(prod, { readonly: true });
    openHandles.push(shipped);
    const tables = shipped
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
      .all()
      .map((r) => r.name);
    expect(tables).not.toContain('vec_commands');
    expect(tables).toContain('commands_fts');
    expect(tables).toContain('vec_intents');
    const ver = shipped
      .prepare("SELECT value FROM meta WHERE key = 'search_algorithm_version'")
      .get();
    expect(Number(ver.value)).toBe(SEARCH_ALGORITHM_VERSION);
    shipped.close();

    const st = openDb(staging, { readonly: true });
    openHandles.push(st);
    const stTables = st
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
      .all()
      .map((r) => r.name);
    expect(stTables).toContain('vec_commands');
    st.close();
  });
});
