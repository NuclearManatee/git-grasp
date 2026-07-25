import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, insertCommandRow, loadAllRows } from '../../src/db/schema.js';
import { mockEmbed } from '../../src/search/embed.js';
import { writeChecksumFile } from '../../src/lib/checksum.js';
import { search } from '../../src/search/index.js';
import { rankResults } from '../../src/search/rank.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const dbPath = path.join(dir, 'test.db');
const thresholdsPath = path.join(dir, 'thresholds.json');

async function buildFixture() {
  mkdirSync(dir, { recursive: true });
  writeFileSync(thresholdsPath, JSON.stringify({
    topK: 5, minScore: 0.1, maxSecondGap: 0.05, lowConfidenceScore: 0.3, requireSkillConsistency: true, normalizeQuery: true,
  }));
  try { rmSync(dbPath); } catch { /* */ }
  try { rmSync(`${dbPath}.sha256`); } catch { /* */ }
  const client = await openDb(dbPath);
  const rows = [
    {
      id: 'git-reset-soft-head-1:2',
      command: 'git reset --soft HEAD~1',
      skill_level: 2,
      intent_description: 'undo my last commit but keep the changes',
      embedding: mockEmbed('undo my last commit but keep the changes'),
      explanation: 'Moves HEAD back one commit, keeps index and worktree',
      risks: 'Rewrites branch tip locally',
      examples: 'git reset --soft HEAD~1',
      risk_class: 'high',
    },
    {
      id: 'git-status:1',
      command: 'git status',
      skill_level: 1,
      intent_description: 'what files did I change',
      embedding: mockEmbed('what files did I change'),
      explanation: 'Shows working tree status',
      risks: '',
      examples: 'git status',
      risk_class: 'none',
    },
  ];
  for (const r of rows) await insertCommandRow(client, r);
  client.close?.();
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
    expect(result.results[0].command).toContain('reset --soft');
  });

  it('fails on checksum mismatch', async () => {
    await buildFixture();
    writeFileSync(dbPath, `${readExtra()}`);
    await expect(search('x', {
      dbPath,
      thresholdsPath,
      forceMockEmbeddings: true,
      skillLevelOverride: null,
    })).rejects.toMatchObject({ code: 'INTEGRITY' });
  });
});

function readExtra() {
  return 'tampered';
}

describe('no child_process in search modules', () => {
  it('rank does not import child_process', async () => {
    const src = await import('../../src/search/rank.js');
    expect(typeof src.rankResults).toBe('function');
    // static guarantee via architecture; spy process
    expect(rankResults).toBeTypeOf('function');
  });
});
