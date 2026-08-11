// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEvolve } from '../../common/src/evolve/runEvolve.js';
import { readEvolveCursor, writeEvolveCursor } from '../../common/src/evolve/cursor.js';
import { feederToFailure } from '../../common/src/evolve/chain.js';
import { evolveStatsJsonPath, evolveFeederTrainPath } from '../../common/src/evolve/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, '../.tmp-evolve-run');

describe('evolve runEvolve fixture', () => {
  beforeEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('cursor roundtrip', () => {
    writeEvolveCursor({ last_pulled_at: '2026-01-01T00:00:00.000Z', last_event_id: 'e1' }, tmpRoot);
    const c = readEvolveCursor(tmpRoot);
    expect(c.last_event_id).toBe('e1');
  });

  it('PULL skipped with fixtures → FILTER → THREAD → feeder --no-chain', async () => {
    const t = Date.now();
    const result = await runEvolve({
      root: tmpRoot,
      noChain: true,
      llmLabel: false,
      writeDocs: true,
      events: [
        {
          id: 'good1',
          name: 'cli_search',
          createdAt: t,
          data: {
            query: 'undo last commit keep files',
            session_id: 'sess-a',
            catalog_version: 5,
            mock: false,
            response: { status: 'empty', confidence: 0, displayCount: 0, results: [] },
          },
        },
        {
          id: 'junk',
          name: 'cli_search',
          createdAt: t + 10,
          data: {
            query: 'email me at leak@example.com',
            session_id: 'sess-b',
            catalog_version: 5,
            response: { status: 'empty', confidence: 0, displayCount: 0, results: [] },
          },
        },
        {
          id: 'mock',
          name: 'cli_search',
          createdAt: t + 20,
          data: {
            query: 'create branch',
            mock: true,
            catalog_version: 5,
            response: { status: 'ok', confidence: 0.9, displayCount: 1, results: [] },
          },
        },
        {
          id: 'refine',
          name: 'cli_search',
          createdAt: t + 20_000,
          data: {
            query: 'undo last commit but keep my changes',
            session_id: 'sess-a',
            catalog_version: 5,
            response: { status: 'empty', confidence: 0.05, displayCount: 0, results: [] },
          },
        },
      ],
    });

    expect(result.stats.filtered_kept).toBeGreaterThanOrEqual(1);
    expect(result.stats.drop_reasons.pii_email).toBe(1);
    expect(result.stats.drop_reasons.mock).toBe(1);
    expect(result.feederTrain.length + result.feederHoldout.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(evolveFeederTrainPath(tmpRoot))).toBe(true);
    expect(existsSync(evolveStatsJsonPath(tmpRoot))).toBe(true);
    const stats = JSON.parse(readFileSync(evolveStatsJsonPath(tmpRoot), 'utf8'));
    expect(stats.chain.ran).toBe(false);
    const fail = feederToFailure(result.feederTrain[0] || result.feederHoldout[0]);
    expect(fail.source).toBe('observe');
    expect(fail.query).toBeTruthy();
  });

  it('chain smoke with mocked triage', async () => {
    const t = Date.now();
    const result = await runEvolve({
      root: tmpRoot,
      noChain: false,
      llmLabel: false,
      writeDocs: false,
      allowVersionBump: false,
      db: { /* unused when apply mocked */ },
      triageFailure: async () => ({ bucket: 1, correct_recipe_id: 'r1', reason: 'test' }),
      applyTriageAction: async () => ({ ok: true, bucket: 1, action: 'alias_paraphrase' }),
      searchFn: async () => ({ status: 'ok', confidence: 0.8, displayResults: [{ id: 1 }] }),
      events: [
        {
          id: 'm1',
          name: 'cli_search',
          createdAt: t,
          data: {
            query: 'unique miss query for chain smoke xyz',
            session_id: 'c1',
            catalog_version: 5,
            response: { status: 'empty', confidence: 0, displayCount: 0, results: [] },
          },
        },
      ],
    });
    expect(result.stats.chain.ran).toBe(true);
    expect(result.stats.chain.ok).toBe(true);
    expect(result.stats.chain.triaged).toBeGreaterThanOrEqual(0);
  });
});
