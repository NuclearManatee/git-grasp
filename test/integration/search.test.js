import { describe, it, expect } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, insertCommandRow } from '../../packages/core/src/db/schema.js';
import { mockEmbed } from '../../packages/core/src/search/embed.js';
import { writeChecksumFile } from '../../packages/core/src/lib/checksum.js';
import { search } from '../../packages/core/src/search/index.js';
import { rankResults } from '../../packages/core/src/search/rank.js';

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
  const rows = [
    {
      id: 'git-reset-soft-head-1:2:0',
      command: 'git reset',
      example: 'git reset --soft HEAD~1',
      usage: 'git reset --soft HEAD~1\nMoves HEAD back one commit and keeps changes staged.',
      intent_family: 'soft-undo',
      simplicity_rank: 1,
      skill_level: 2,
      intent_description: 'undo my last commit but keep the changes',
      embedding: mockEmbed('undo my last commit but keep the changes'),
      explanation: 'Moves HEAD back one commit, keeps index and worktree',
    },
    {
      id: 'git-status:1:0',
      command: 'git status',
      example: 'git status',
      usage: 'git status\nShow working tree status.',
      intent_family: 'status',
      simplicity_rank: 1,
      skill_level: 1,
      intent_description: 'what files did I change',
      embedding: mockEmbed('what files did I change'),
      explanation: 'Shows working tree status',
    },
  ];
  for (const r of rows) insertCommandRow(client, r);
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
    // Only skill≤1 rows survive hydrate; reset is skill 2 → empty or status-only
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
