import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  openDb,
  insertCommand,
  insertIntentWithEmbedding,
  insertCommandEmbedding,
  knnRecall,
  knnRecallCommands,
  findCommandByHashPair,
  deleteCommandCascade,
  countCommands,
  promoteStagingDb,
  SCHEMA_VERSION,
  parseCommands,
  renderSnippet,
} from '../../common/src/db/schema.js';
import { mockEmbed } from '../../common/src/search/embed.js';
import { compareSimplicity, dedupDecision, countFlags } from '../../common/src/build/dedup.js';
import { createWriterQueue } from '../../common/src/build/writerQueue.js';

describe('schema v7', () => {
  it('opens commands + intents + vec tables', () => {
    const db = openDb(':memory:');
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
      .all()
      .map((r) => r.name);
    expect(names).toContain('commands');
    expect(names).toContain('intents');
    expect(names).toContain('vec_intents');
    expect(names).toContain('vec_commands');
    expect(SCHEMA_VERSION).toBe(7);
    db.close();
  });

  it('stores mutation_kind on evolved rows', () => {
    const db = openDb(':memory:');
    const id = insertCommand(db, {
      initial_state: 'git commit --allow-empty -m init\n',
      command_recipe: { commands: [{ command: 'git status -s' }] },
      initial_state_physical_hash: 'i',
      final_state_physical_hash: 'f',
      risk: 0.1,
      mutation_kind: 'flag',
    });
    const row = db.prepare('SELECT mutation_kind FROM commands WHERE row_id = ?').get(id);
    expect(row.mutation_kind).toBe('flag');
    db.close();
  });

  it('inserts command + intent and recalls via KNN', () => {
    const db = openDb(':memory:');
    const id = insertCommand(db, {
      initial_state: 'git commit --allow-empty -m init\n',
      command_recipe: {
        commands: [{ command: 'git reset --soft HEAD~1', comment: 'keep staged' }],
      },
      initial_state_physical_hash: 'init-h',
      final_state_physical_hash: 'final-h',
      risk: 0.4,
    });
    const text = 'undo my last commit but keep the changes';
    insertIntentWithEmbedding(db, {
      command_id: id,
      skill_level: 'beginner',
      intent_category: 'goal',
      intent_text: text,
      embedding: mockEmbed(text),
    });
    insertCommandEmbedding(db, id, mockEmbed('git reset --soft'));

    const hits = knnRecall(db, mockEmbed(text), 5);
    expect(hits.length).toBe(1);
    expect(hits[0].example).toContain('reset --soft');
    expect(hits[0].commands[0].command).toContain('reset --soft');
    expect(hits[0].command_id).toBe(id);
    expect(hits[0].skill_level_text).toBe('beginner');

    const cmdHits = knnRecallCommands(db, mockEmbed('git reset --soft'), 3);
    expect(cmdHits[0].command_id).toBe(id);
    db.close();
  });

  it('dedups by hash pair helpers', () => {
    const db = openDb(':memory:');
    const id = insertCommand(db, {
      initial_state: 'x',
      command_recipe: { commands: [{ command: 'git status' }] },
      initial_state_physical_hash: 'a',
      final_state_physical_hash: 'b',
      risk: 0,
    });
    expect(findCommandByHashPair(db, 'a', 'b').row_id).toBe(id);
    deleteCommandCascade(db, id);
    expect(countCommands(db)).toBe(0);
    db.close();
  });

  it('promotes staging to prod path', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gh-promote-'));
    const staging = path.join(dir, 'staging.db');
    const prod = path.join(dir, 'prod.db');
    const db = openDb(staging);
    insertCommand(db, {
      initial_state: 'x',
      command_recipe: { commands: [{ command: 'git status' }] },
      initial_state_physical_hash: 'a',
      final_state_physical_hash: 'b',
      risk: 0,
    });
    db.close();
    promoteStagingDb(staging, prod);
    const pdb = openDb(prod, { readonly: true });
    expect(countCommands(pdb)).toBe(1);
    pdb.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows may keep a lock briefly */
    }
  });

  it('renders snippets with command key', () => {
    const snippet = renderSnippet([
      { command: 'git add .', comment: 'stage everything' },
      { command: 'git commit -m "msg"', comment: '' },
    ]);
    expect(snippet).toContain('git add .  # stage everything');
    expect(parseCommands('{"commands":[{"command":"git status","comment":"x"}]}')[0].command).toBe(
      'git status',
    );
  });
});

describe('dedup simplicity', () => {
  it('prefers fewer flags', () => {
    const simple = { commands: [{ command: 'git reset HEAD~1' }] };
    const complex = { commands: [{ command: 'git reset --soft HEAD~1' }] };
    expect(countFlags(complex)).toBeGreaterThan(countFlags(simple));
    expect(compareSimplicity(simple, complex)).toBeLessThan(0);
    expect(dedupDecision({ command_recipe: complex }, { command_recipe: simple })).toBe(
      'replace_existing',
    );
  });
});

describe('writer queue', () => {
  it('serializes writes', async () => {
    const db = openDb(':memory:');
    const q = createWriterQueue(db);
    const ids = await Promise.all([
      q.run((d) =>
        insertCommand(d, {
          initial_state: 'a',
          command_recipe: { commands: [{ command: 'git status' }] },
          initial_state_physical_hash: '1',
          final_state_physical_hash: '2',
          risk: 0,
        }),
      ),
      q.run((d) =>
        insertCommand(d, {
          initial_state: 'b',
          command_recipe: { commands: [{ command: 'git log' }] },
          initial_state_physical_hash: '3',
          final_state_physical_hash: '4',
          risk: 0,
        }),
      ),
    ]);
    expect(ids).toHaveLength(2);
    expect(countCommands(db)).toBe(2);
    db.close();
  });
});
