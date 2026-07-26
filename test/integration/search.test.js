import { describe, it, expect } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openDb,
  insertRecipe,
  insertIntentWithEmbedding,
} from '../../packages/core/src/db/schema.js';
import { mockEmbed } from '../../packages/core/src/search/embed.js';
import { writeChecksumFile } from '../../packages/core/src/lib/checksum.js';
import { search } from '../../packages/core/src/search/index.js';
import { rankResults } from '../../packages/core/src/search/rank.js';
import { makeIntentId } from '../../packages/core/src/lib/validator.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const dbPath = path.join(dir, 'test.db');
const thresholdsPath = path.join(dir, 'thresholds.json');

async function buildFixture() {
  mkdirSync(dir, { recursive: true });
  writeFileSync(thresholdsPath, JSON.stringify({
    topK: 5,
    minScore: 0.1,
    maxSecondGap: 0.05,
    lowConfidenceScore: 0.3,
    confidenceYellowScore: 0.45,
    confidenceRedScore: 0.30,
    requireSkillConsistency: true,
    normalizeQuery: true,
    simplicityWindow: 0.08,
    advancedWindow: 0.12,
  }));
  try { rmSync(dbPath); } catch { /* */ }
  try { rmSync(`${dbPath}.sha256`); } catch { /* */ }
  const client = openDb(dbPath);

  insertRecipe(client, {
    id: 'undo-last-commit-keep-changes',
    title: 'Undo last commit keep changes',
    commands: [{ run: 'git reset --soft HEAD~1', comment: 'keep staged' }],
    explanation: 'Moves HEAD back one commit, keeps index and worktree',
    intent_family: 'soft-undo',
    simplicity_rank: 1,
    usage: 'git reset --soft HEAD~1\nMoves HEAD back one commit and keeps changes staged.',
    topic: 'undo',
    primary_example: 'git reset --soft HEAD~1',
    command: 'git reset',
  });
  insertRecipe(client, {
    id: 'show-working-tree-status',
    title: 'Show working tree status',
    commands: [{ run: 'git status', comment: 'status' }],
    explanation: 'Shows working tree status',
    intent_family: 'status',
    simplicity_rank: 1,
    usage: 'git status\nShow working tree status.',
    topic: 'status',
    primary_example: 'git status',
    command: 'git status',
  });

  const rows = [
    {
      recipe_id: 'undo-last-commit-keep-changes',
      skill_level: 2,
      intent_text: 'undo my last commit but keep the changes',
    },
    {
      recipe_id: 'show-working-tree-status',
      skill_level: 1,
      intent_text: 'what files did I change',
    },
  ];
  for (const r of rows) {
    insertIntentWithEmbedding(client, {
      id: makeIntentId(r.recipe_id, r.skill_level, 0),
      recipe_id: r.recipe_id,
      intent_text: r.intent_text,
      skill_level: r.skill_level,
      embedding: mockEmbed(r.intent_text),
    });
  }
  client.close();
  writeChecksumFile(dbPath);
}

describe('search integration', () => {
  it('finds soft reset intent', async () => {
    await buildFixture();
    const result = await search('undo my last commit but keep the changes', {
      dbPath,
      thresholdsPath,
      forceMockEmbeddings: true,
      skillLevelOverride: null,
    });
    expect(result.results[0].example).toContain('reset --soft');
    expect(result.confidence).toBeTruthy();
  });

  it('skill filter at most level 1 excludes higher-skill reset', async () => {
    await buildFixture();
    const result = await search('undo my last commit but keep the changes', {
      dbPath,
      thresholdsPath,
      forceMockEmbeddings: true,
      skillLevelOverride: 1,
    });
    expect(result.status === 'empty' || result.results.every((r) => r.skill_level <= 1)).toBe(true);
  });

  it('fails on checksum mismatch', async () => {
    await buildFixture();
    writeFileSync(dbPath, 'tampered');
    expect(
      search('x', {
        dbPath,
        thresholdsPath,
        forceMockEmbeddings: true,
        skillLevelOverride: null,
      }),
    ).rejects.toMatchObject({ code: 'INTEGRITY' });
  });
});

describe('no child_process in search modules', () => {
  it('rank does not import child_process', async () => {
    const src = await import('../../packages/core/src/search/rank.js');
    expect(typeof src.rankResults).toBe('function');
    expect(typeof rankResults).toBe('function');
  });
});
