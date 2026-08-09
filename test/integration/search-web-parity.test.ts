import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  openDb,
  insertRecipe,
  finalizeSearchIndex,
  EMBEDDING_DIM,
} from '../../common/src/db/schema.js';
import { mockEmbed } from '../../common/src/search/embed.js';
import { writeChecksumFile } from '../../common/src/lib/checksum.js';
import { exportWebCatalog } from '../../common/src/search/webCatalog.js';
import { search } from '../../common/src/search/index.js';
import {
  openWebCatalog,
  searchBrowser,
  resetWebPackForTests,
} from '../../common/src/search/browser.js';

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
    rmSync(`${webDb}.sha256`, { force: true });
  } catch {
    /* */
  }

  const db = openDb(sourceDb);
  insertRecipe(
    db,
    {
      id: 'r-undo',
      title: 'Soft reset',
      description: 'undo last commit keep files',
      tags: ['undo'],
      taxonomy_leaf: 'undo',
      paraphrases: [],
      provenance: 'synthetic',
      validated: true,
      commands: [{ command: 'git reset --soft HEAD~1', comment: 'keep' }],
      initial_state: '',
      risk: 0.3,
    },
    embFromText('undo last commit keep files'),
  );
  finalizeSearchIndex(db);
  db.close();
  writeChecksumFile(sourceDb);

  exportWebCatalog(sourceDb, webDb, { thresholdsPath });
});

afterAll(() => {
  resetWebPackForTests();
});

describe('CLI ↔ web hybrid parity', () => {
  it('same top recipe id for mock-embed query', async () => {
    const cli = await search('undo last commit keep files', {
      dbPath: sourceDb,
      thresholdsPath,
      forceMockEmbeddings: true,
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
    });

    expect(String(cli.results[0]?.command_id)).toBe(String(web.results[0]?.command_id));
    expect(Math.abs(cli.results[0].score - web.results[0].score)).toBeLessThan(0.15);
  });
});
