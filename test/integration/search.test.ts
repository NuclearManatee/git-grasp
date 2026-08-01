import { describe, it, expect } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openDb,
  insertCommand,
  insertIntentWithEmbedding,
  finalizeSearchIndex,
  EMBEDDING_DIM,
} from '../../common/src/db/schema.js';
import { mockEmbed } from '../../common/src/search/embed.js';
import { writeChecksumFile } from '../../common/src/lib/checksum.js';
import { search } from '../../common/src/search/index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const dbPath = path.join(dir, 'hybrid-search.db');
const thresholdsPath = path.join(dir, 'hybrid-thresholds.json');

function embFromText(text) {
  const v = mockEmbed(text);
  if (v.length === EMBEDDING_DIM) return v;
  const out = new Float32Array(EMBEDDING_DIM);
  out.set(v.subarray(0, Math.min(v.length, EMBEDDING_DIM)));
  return out;
}

async function buildFixture() {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    thresholdsPath,
    JSON.stringify({
      schemaVersion: 5,
      topK: 3,
      recallK: 100,
      confidenceVeryHigh: 0.9,
      confidenceHigh: 0.75,
      confidenceMedium: 0.4,
      normalizeQuery: true,
    }),
  );
  try {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}.sha256`, { force: true });
  } catch {
    /* */
  }

  const client = openDb(dbPath);
  const undoId = insertCommand(client, {
    initial_state: 'git commit --allow-empty -m x\n',
    command_recipe: {
      commands: [{ command: 'git reset --soft HEAD~1', comment: 'keep staged' }],
    },
    initial_state_physical_hash: 'u1',
    final_state_physical_hash: 'u2',
    risk: 0.4,
  });
  const statusId = insertCommand(client, {
    initial_state: 'git commit --allow-empty -m x\n',
    command_recipe: {
      commands: [{ command: 'git status', comment: 'show tree' }],
    },
    initial_state_physical_hash: 's1',
    final_state_physical_hash: 's2',
    risk: 0.05,
  });
  const stashId = insertCommand(client, {
    initial_state: 'git init\n',
    command_recipe: {
      commands: [{ command: 'git stash push -u', comment: 'stash dirty' }],
    },
    initial_state_physical_hash: 't1',
    final_state_physical_hash: 't2',
    risk: 0.2,
  });

  insertIntentWithEmbedding(client, {
    command_id: undoId,
    skill_level: 'beginner',
    intent_category: 'goal',
    intent_text: 'undo last commit keep files',
    embedding: embFromText('undo last commit keep files'),
  });
  insertIntentWithEmbedding(client, {
    command_id: statusId,
    skill_level: 'beginner',
    intent_category: 'goal',
    intent_text: 'show working tree status',
    embedding: embFromText('show working tree status'),
  });
  insertIntentWithEmbedding(client, {
    command_id: stashId,
    skill_level: 'intermediate',
    intent_category: 'goal',
    intent_text: 'stash untracked changes',
    embedding: embFromText('stash untracked changes'),
  });

  finalizeSearchIndex(client);
  client.close();
  writeChecksumFile(dbPath);
  return { undoId, statusId, stashId };
}

describe('hybrid search()', () => {
  it('ranks undo query with undo command_id in internal results', async () => {
    const { undoId } = await buildFixture();
    const result = await search('undo last commit keep files', {
      dbPath,
      thresholdsPath,
      forceMockEmbeddings: true,
      skillLevelOverride: null,
    });
    expect(result.results.length).toBeGreaterThan(0);
    const ids = result.results.slice(0, 3).map((r) => r.command_id);
    expect(ids).toContain(undoId);
    expect(result.blend).toBeDefined();
    expect(typeof result.confidence).toBe('number');
    expect(result.displayResults.length).toBeLessThanOrEqual(3);
    expect(result.results.length).toBeGreaterThanOrEqual(result.displayResults.length);
  });

  it('lexical path finds --soft via FTS', async () => {
    const { undoId } = await buildFixture();
    const result = await search('reset --soft', {
      dbPath,
      thresholdsPath,
      forceMockEmbeddings: true,
      skillLevelOverride: 'expert',
    });
    expect(result.preferredSkill).toBe('expert');
    expect(result.blend.alpha).toBe(0.3);
    const ids = result.results.slice(0, 3).map((r) => r.command_id);
    expect(ids).toContain(undoId);
  });
});
