import { describe, it, expect } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openDb,
  insertRecipe,
  finalizeSearchIndex,
  EMBEDDING_DIM,
} from '../../common/src/db/schema.js';
import { mockEmbed } from '../../common/src/search/embed.js';
import { writeChecksumFile } from '../../common/src/lib/checksum.js';
import { search } from '../../common/src/search/index.js';
import { DEFAULT_ALPHA, DEFAULT_BETA } from '../../common/src/search/hybrid.js';

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
  insertRecipe(
    client,
    {
      id: 'r-undo',
      title: 'Soft reset last commit',
      description: 'undo last commit keep files',
      tags: ['undo'],
      taxonomy_leaf: 'undo',
      paraphrases: [],
      provenance: 'synthetic',
      validated: true,
      commands: [{ command: 'git reset --soft HEAD~1', comment: 'keep staged' }],
      initial_state: '',
      risk: 0.4,
    },
    embFromText('undo last commit keep files'),
  );
  insertRecipe(
    client,
    {
      id: 'r-status',
      title: 'Show status',
      description: 'show working tree status',
      tags: ['inspect'],
      taxonomy_leaf: 'inspect',
      paraphrases: [],
      provenance: 'synthetic',
      validated: true,
      commands: [{ command: 'git status', comment: 'show tree' }],
      initial_state: '',
      risk: 0.05,
    },
    embFromText('show working tree status'),
  );
  insertRecipe(
    client,
    {
      id: 'r-stash',
      title: 'Stash untracked',
      description: 'stash untracked changes',
      tags: ['stash'],
      taxonomy_leaf: 'stash',
      paraphrases: [],
      provenance: 'synthetic',
      validated: true,
      commands: [{ command: 'git stash push -u', comment: 'stash dirty' }],
      initial_state: '',
      risk: 0.2,
    },
    embFromText('stash untracked changes'),
  );

  finalizeSearchIndex(client);
  client.close();
  writeChecksumFile(dbPath);
  return { undoId: 'r-undo', statusId: 'r-status', stashId: 'r-stash' };
}

describe('hybrid search()', () => {
  it('ranks undo query with undo recipe id in results', async () => {
    const { undoId } = await buildFixture();
    const result = await search('undo last commit keep files', {
      dbPath,
      thresholdsPath,
      forceMockEmbeddings: true,
    });
    expect(result.results.length).toBeGreaterThan(0);
    const ids = result.results.slice(0, 3).map((r) => String(r.command_id));
    expect(ids).toContain(undoId);
    expect(result.blend).toEqual({ alpha: DEFAULT_ALPHA, beta: DEFAULT_BETA });
    expect(typeof result.confidence).toBe('number');
    expect(result.displayResults.length).toBeLessThanOrEqual(3);
    expect(result.results.length).toBeGreaterThanOrEqual(result.displayResults.length);
    expect(result.displayResults[0]?.title).toBeTruthy();
    expect(result.displayResults[0]?.description).toBeTruthy();
  });

  it('lexical path finds --soft via FTS', async () => {
    const { undoId } = await buildFixture();
    const result = await search('reset --soft', {
      dbPath,
      thresholdsPath,
      forceMockEmbeddings: true,
    });
    expect(result.blend.alpha).toBe(DEFAULT_ALPHA);
    const ids = result.results.slice(0, 3).map((r) => String(r.command_id));
    expect(ids).toContain(undoId);
  });
});
