import { describe, it, expect } from 'bun:test';
import {
  openDb,
  insertRecipe,
  insertIntentWithEmbedding,
  knnRecall,
  loadAllRows,
  parseCommands,
  renderSnippet,
  SCHEMA_VERSION,
} from '../../packages/core/src/db/schema.js';
import { mockEmbed } from '../../packages/core/src/search/embed.js';
import { validateRecipe, validateSearchIntent, makeIntentId } from '../../packages/core/src/lib/validator.js';

describe('schema v5', () => {
  it('opens recipes + search_intents + vec_intents', () => {
    const db = openDb(':memory:');
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
      .all()
      .map((r) => r.name);
    expect(names).toContain('recipes');
    expect(names).toContain('search_intents');
    expect(names).toContain('vec_intents');
    expect(SCHEMA_VERSION).toBe(5);
    db.close();
  });

  it('inserts recipe + intent and recalls via KNN', () => {
    const db = openDb(':memory:');
    insertRecipe(db, {
      id: 'undo-last-commit-keep-changes',
      title: 'Undo last commit keep changes',
      commands: [{ run: 'git reset --soft HEAD~1', comment: 'keep staged' }],
      explanation: 'soft reset',
      intent_family: 'soft-undo',
      simplicity_rank: 1,
      usage: 'git reset --soft HEAD~1\nkeep changes',
      topic: 'undo',
      primary_example: 'git reset --soft HEAD~1',
      command: 'git reset',
    });
    const text = 'undo my last commit but keep the changes';
    insertIntentWithEmbedding(db, {
      id: makeIntentId('undo-last-commit-keep-changes', 2, 0),
      recipe_id: 'undo-last-commit-keep-changes',
      intent_text: text,
      skill_level: 2,
      embedding: mockEmbed(text),
    });

    const hits = knnRecall(db, mockEmbed(text), 5);
    expect(hits.length).toBe(1);
    expect(hits[0].example).toContain('reset --soft');
    expect(hits[0].commands[0].run).toContain('reset --soft');
    expect(hits[0].intent_description).toBe(text);
    expect(hits[0].skill_level).toBe(2);

    const all = loadAllRows(db);
    expect(all[0].recipe_id).toBe('undo-last-commit-keep-changes');
    db.close();
  });

  it('renders inline-comment snippets', () => {
    const snippet = renderSnippet([
      { run: 'git add .', comment: 'stage everything' },
      { run: 'git commit -m "msg"', comment: '' },
    ]);
    expect(snippet).toContain('git add .  # stage everything');
    expect(snippet).toContain('git commit -m "msg"');
    expect(parseCommands('[{"run":"git status","comment":"x"}]')[0].run).toBe('git status');
  });
});

describe('validateRecipe', () => {
  it('accepts valid multi-step recipe', () => {
    const v = validateRecipe({
      id: 'topic-branch',
      title: 'Topic branch',
      commands: [
        { run: 'git switch -c feature/login', comment: 'create' },
        { run: 'git switch main', comment: 'back' },
      ],
      primary_example: 'git switch -c feature/login',
      command: 'git switch',
    });
    expect(v.ok).toBe(true);
  });

  it('rejects shell meta in runs', () => {
    const v = validateRecipe({
      id: 'bad',
      title: 'Bad',
      commands: [{ run: 'git status && git log', comment: '' }],
      primary_example: 'git status && git log',
      command: 'git status',
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('shell_meta');
  });

  it('validateSearchIntent checks FK', () => {
    const ok = validateSearchIntent({
      id: 'r:1:0',
      recipe_id: 'r',
      intent_text: 'hello',
      skill_level: 1,
    }, { recipeIds: new Set(['r']) });
    expect(ok.ok).toBe(true);
    const bad = validateSearchIntent({
      id: 'r:1:0',
      recipe_id: 'missing',
      intent_text: 'hello',
      skill_level: 1,
    }, { recipeIds: new Set(['r']) });
    expect(bad.ok).toBe(false);
  });
});
