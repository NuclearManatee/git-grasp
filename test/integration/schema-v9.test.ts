// @ts-nocheck
/**
 * Schema v9 + description hybrid search smoke (Bun test).
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  openDb,
  insertRecipe,
  finalizeSearchIndex,
  knnRecall,
  ftsRecall,
  SCHEMA_VERSION,
  SEARCH_ALGORITHM_VERSION,
  getMetaValue,
} from '../../common/src/db/schema.ts';
import { searchHybrid } from '../../common/src/search/hybrid.ts';
import { mockEmbed } from '../../common/src/search/embed.ts';

describe('schema v9 recipes', () => {
  let dir;
  let dbPath;
  let db;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gg-v9-'));
    dbPath = path.join(dir, 't.db');
    db = openDb(dbPath);
    const emb = mockEmbed('show working tree status');
    insertRecipe(
      db,
      {
        id: 'r-status',
        commands: [{ command: 'git status', comment: 'status' }],
        title: 'Show status',
        description: 'show working tree status',
        tags: ['inspect'],
        taxonomy_leaf: 'inspection-status',
        paraphrases: ['what changed'],
        provenance: 'synthetic',
        validated: true,
        initial_state: '',
        risk: 0,
      },
      emb,
    );
    finalizeSearchIndex(db);
  });

  afterAll(() => {
    try {
      db.close();
    } catch {
      /* */
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows may keep the sqlite handle briefly */
    }
  });

  test('stamps schema and search versions', () => {
    expect(Number(getMetaValue(db, 'schema_version'))).toBe(SCHEMA_VERSION);
    expect(Number(getMetaValue(db, 'search_algorithm_version'))).toBe(
      SEARCH_ALGORITHM_VERSION,
    );
  });

  test('knn recalls description embedding', () => {
    const hits = knnRecall(db, mockEmbed('show working tree status'), 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(String(hits[0].command_id)).toBe('r-status');
    expect(hits[0].title).toBe('Show status');
    expect(hits[0].description).toContain('status');
  });

  test('fts recalls flag/literal terms', () => {
    const hits = ftsRecall(db, 'status', 5);
    expect(hits.some((h) => String(h.recipe_id) === 'r-status')).toBe(true);
  });

  test('hybrid returns title+description display hits', async () => {
    const result = await searchHybrid({
      query: 'show status',
      thresholds: {
        schemaVersion: 5,
        topK: 3,
        recallK: 10,
        confidenceVeryHigh: 0.9,
        confidenceHigh: 0.75,
        confidenceMedium: 0.4,
        normalizeQuery: true,
      },
      verbs: ['status'],
      embed: async () => mockEmbed('show status'),
      knn: (vec, k) => knnRecall(db, vec, k),
      fts: (q, k) => ftsRecall(db, q, k),
      hydrate: (ids) =>
        ids.map((id) => {
          const hit = knnRecall(db, mockEmbed('x'), 100).find(
            (h) => String(h.command_id) === String(id),
          );
          return (
            hit || {
              command_id: id,
              commands: [{ command: 'git status' }],
              example: 'git status',
              snippet: 'git status',
              title: 'Show status',
              description: 'show working tree status',
              risk: 0,
            }
          );
        }),
    });
    expect(result.displayResults.length).toBeGreaterThan(0);
    expect(result.displayResults[0].title).toBeTruthy();
    expect(result.displayResults[0].description).toBeTruthy();
  });
});
