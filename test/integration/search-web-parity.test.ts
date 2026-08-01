import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  openDb,
  insertCommand,
  insertIntentWithEmbedding,
  insertCommandEmbedding,
  finalizeSearchIndex,
  EMBEDDING_DIM,
} from '../../packages/core/src/db/schema.js';
import { mockEmbed } from '../../packages/core/src/search/embed.js';
import { writeChecksumFile } from '../../packages/core/src/lib/checksum.js';
import { exportWebCatalog } from '../../packages/core/src/search/webCatalog.js';
import { search } from '../../packages/core/src/search/index.js';
import {
  openWebCatalog,
  searchBrowser,
  resetWebPackForTests,
} from '../../packages/core/src/search/browser.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/web-parity');
const sourceDb = path.join(dir, 'source.db');
const webDb = path.join(dir, 'web-catalog.db');
const thresholdsPath = path.join(dir, 'thresholds.json');

function embFromText(text) {
  const v = mockEmbed(text);
  const out = new Float32Array(EMBEDDING_DIM);
  out.set(v.subarray(0, Math.min(v.length, EMBEDDING_DIM)));
  return out;
}

beforeAll(() => {
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
    rmSync(sourceDb, { force: true });
    rmSync(`${sourceDb}.sha256`, { force: true });
    rmSync(webDb, { force: true });
  } catch {
    /* */
  }

  const db = openDb(sourceDb);
  const undoId = insertCommand(db, {
    initial_state: 'git init\n',
    command_recipe: {
      commands: [{ command: 'git reset --soft HEAD~1', comment: 'keep' }],
    },
    initial_state_physical_hash: 'a',
    final_state_physical_hash: 'b',
    risk: 0.3,
  });
  insertCommandEmbedding(db, undoId, embFromText('reset soft'));
  insertIntentWithEmbedding(db, {
    command_id: undoId,
    skill_level: 'beginner',
    intent_category: 'goal',
    intent_text: 'undo last commit keep files',
    embedding: embFromText('undo last commit keep files'),
  });
  finalizeSearchIndex(db);
  db.close();
  writeChecksumFile(sourceDb);

  exportWebCatalog(sourceDb, webDb, { thresholdsPath });
});

afterAll(() => {
  resetWebPackForTests();
});

describe('CLI ↔ web hybrid parity', () => {
  it('same top command_id for mock-embed query', async () => {
    const cli = await search('undo last commit keep files', {
      dbPath: sourceDb,
      thresholdsPath,
      forceMockEmbeddings: true,
      skillLevelOverride: 'beginner',
    });

    const bytes = readFileSync(webDb);
    const sha = readFileSync(`${webDb}.sha256`, 'utf8').trim().split(/\s+/)[0];
    const wasmPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../node_modules/sql.js/dist/sql-wasm.wasm',
    );
    await openWebCatalog(bytes, {
      expectedSha256: sha,
      initSqlJs: () =>
        initSqlJs({
          locateFile: () => wasmPath,
        }),
    });

    const web = await searchBrowser('undo last commit keep files', {
      forceMockEmbeddings: true,
      skillLevelOverride: 'beginner',
    });

    expect(cli.results[0]?.command_id).toBe(web.results[0]?.command_id);
    expect(Math.abs(cli.results[0].score - web.results[0].score)).toBeLessThan(0.15);
  });
});
